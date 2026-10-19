import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCw,
  Target,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import {
  AVAILABLE_SETS,
  PER_QUESTION_SECONDS,
  accuracy,
  formatClock,
  parsePracticeSummary,
} from '@/lib/practiceCore';
import type { MistakeItem, MissionSummary, PracticeQuestion } from '@/lib/practiceCore';
import {
  abandonPracticeAttempt,
  completeMission,
  createMission,
  fetchPracticeQuestions,
  fetchPracticeSummary,
  finishPracticeAttempt,
  startPracticeAttempt,
  submitPracticeAttempt,
} from '@/lib/practice';
import { MissionCompleteCard } from '@/components/practice/MissionCompleteCard';
import { MissionCelebration } from '@/components/practice/MissionCelebration';
import { fetchAchievements } from '@/lib/achievements';
import type { Badge } from '@/lib/achievements';

type CompleteResultShape = {
  status?: string;
  reason?: string;
  correct?: number;
  total?: number;
  attemptNumber?: number;
  completedAttempts?: number;
};

type RunnerPhase = 'answering' | 'graded' | 'done';

interface RunnerState {
  index: number;
  phase: RunnerPhase;
  quizAttemptId: string | null;
  attemptNumber: number | null;
  answers: Record<string, number | null>;
  results: Record<string, { isCorrect: boolean; skipped: boolean; correctIndex: number; explanation: string }>;
  finishResult: { status: string; correct?: number; total?: number; isPassing?: boolean } | null;
}

const INITIAL_RUNNER: RunnerState = {
  index: 0,
  phase: 'answering',
  quizAttemptId: null,
  attemptNumber: null,
  answers: {},
  results: {},
  finishResult: null,
};

function SetHeader({ slug, onBack }: { slug: string; onBack: () => void }) {
  const set = AVAILABLE_SETS.find((s) => s.slug === slug);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
          <BookOpenCheck className="h-5 w-5 text-accent-strong" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">
            {set?.subject ?? 'Practice'} · reviewed question set
          </p>
          <h1 className="font-display text-2xl font-bold text-ink">{set?.label ?? slug}</h1>
        </div>
      </div>
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All practice
      </Button>
    </div>
  );
}

function Feedback({ question, result }: { question: PracticeQuestion; result: NonNullable<RunnerState['results'][string]> }) {
  const correct = result.isCorrect;
  const skipped = result.skipped;
  return (
    <div
      className={`mt-6 rounded-2xl border p-4 sm:p-5 ${
        correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
      }`}
      role="status"
    >
      <p className={`flex items-center gap-2 font-display text-base font-bold ${correct ? 'text-green-800' : 'text-red-800'}`}>
        {correct ? <Check className="h-5 w-5" aria-hidden /> : <X className="h-5 w-5" aria-hidden />}
        {skipped ? 'Time ran out — marked incorrect' : correct ? 'Correct' : 'Not quite'}
      </p>
      {!correct && !skipped && (
        <p className="mt-1.5 text-sm text-red-800">
          Correct answer: <span className="font-semibold">{question.options[result.correctIndex]}</span>
        </p>
      )}
      <p className="mt-2 text-sm leading-relaxed text-gray-700">{result.explanation}</p>
    </div>
  );
}

function MissionCreator({
  mission,
  defaultSlug,
  onCreated,
  onStartPractice,
}: {
  mission: MissionSummary | null;
  defaultSlug: string;
  onCreated: (m: MissionSummary) => void;
  onStartPractice: (slug: string) => void;
}) {
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mission) {
    return (
      <section aria-label="Your active mission" className="mt-8 rounded-2xl border border-accent/30 bg-accent-soft/40 p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
          Your active mission
        </p>
        <p className="mt-1.5 font-display text-lg font-bold leading-snug text-ink">
          {mission.missionText}
        </p>
        <p className="mt-1.5 text-xs text-ink-soft">
          Pending — complete the practice set with at least 80% to finish it.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => onStartPractice(mission.topicSlug || defaultSlug)}>
          <Timer className="h-4 w-4" aria-hidden />
          Go to practice
        </Button>
      </section>
    );
  }

  async function handleCreate() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Describe what you want to learn.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const m = await createMission(trimmed, defaultSlug, null);
      setText('');
      onCreated(m);
    } catch {
      setError('Could not create your mission. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section aria-label="Set a study mission" className="mt-8 rounded-2xl border border-line bg-raised p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
          <Target className="h-4.5 w-4.5 text-accent-strong" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Set a study mission</h2>
          <p className="text-xs text-ink-soft">
            e.g. “Understand photosynthesis and complete practice”
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <TextField
            label="Your mission"
            placeholder="Understand photosynthesis and complete practice"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={280}
            error={error}
            autoComplete="off"
          />
        </div>
        <div className="sm:pt-6">
          <Button onClick={() => void handleCreate()} loading={creating}>
            Start mission
          </Button>
        </div>
      </div>
    </section>
  );
}

function MistakeCard({ mistake, onRetry }: { mistake: MistakeItem; onRetry: () => void }) {
  return (
    <li className="rounded-2xl border border-line bg-raised p-5 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {mistake.subjectName} · {mistake.topicLabel}
      </p>
      <p className="mt-1.5 text-sm font-medium leading-relaxed text-ink">{mistake.prompt}</p>
      <div className="mt-3 space-y-1.5 text-sm">
        {mistake.options.map((opt, i) => {
          const chosen = i === mistake.selectedIndex;
          const right = i === mistake.correctIndex;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                right ? 'bg-green-50 text-green-800' : chosen ? 'bg-red-50 text-red-700' : 'text-ink-soft'
              }`}
            >
              {right ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden />
              ) : chosen ? (
                <X className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <span className="w-4" aria-hidden />
              )}
              <span className={right || chosen ? 'font-medium' : ''}>{opt}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 rounded-xl bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-ink-soft">
        {mistake.explanation}
      </p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        Practice this topic
      </Button>
    </li>
  );
}

export function PracticePage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();

  const [summary, setSummary] = useState<ReturnType<typeof parsePracticeSummary> | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runner, setRunner] = useState<RunnerState>(INITIAL_RUNNER);
  const [remaining, setRemaining] = useState(PER_QUESTION_SECONDS);
  const [completing, setCompleting] = useState(false);
  const [completeResult, setCompleteResult] = useState<CompleteResultShape | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unlockedBadges, setUnlockedBadges] = useState<Badge[]>([]);
  const timerRef = useRef<number | null>(null);
  const activeSlugRef = useRef<string | null>(null);
  const celebratedMissionRef = useRef<string | null>(null);
  const priorBadgesRef = useRef<Set<string>>(new Set());

  const loadSummary = useCallback(async () => {
    try {
      setSummary(parsePracticeSummary(await fetchPracticeSummary()));
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Establish baseline of already-earned badges so we can detect NEW unlocks
  useEffect(() => {
    void (async () => {
      try {
        const summary = await fetchAchievements();
        priorBadgesRef.current = new Set(
          summary.badges.filter((b) => b.earned).map((b) => b.slug)
        );
      } catch {
        // If we can't load baseline, no badge unlocks will show — safe default
      }
    })();
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const openSet = useCallback(
    async (setSlug: string) => {
      setLoadError(null);
      setCompleteResult(null);
      setBusy(true);
      try {
        const start = await startPracticeAttempt(setSlug);
        if (start.status !== 'started' && start.status !== 'in_progress_exists') {
          setLoadError('Could not start your practice attempt. Please try again.');
          return;
        }
        const quizAttemptId = start.quizAttemptId;
        if (!quizAttemptId) {
          setLoadError('Could not start your practice attempt. Please try again.');
          return;
        }
        const qs = await fetchPracticeQuestions(setSlug, quizAttemptId);
        if (qs.length === 0) {
          setLoadError('This practice set is not available yet. Reviewed content only.');
          return;
        }
        setQuestions(qs);
        setRunner({
          ...INITIAL_RUNNER,
          quizAttemptId,
          attemptNumber: start.attemptNumber,
        });
        setRemaining(PER_QUESTION_SECONDS);
        activeSlugRef.current = setSlug;
        navigate(`/practice/${setSlug}`, { replace: true });
      } catch {
        setLoadError('Could not load practice questions. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [navigate]
  );

  const backToList = useCallback(() => {
    stopTimer();
    setQuestions(null);
    setRunner(INITIAL_RUNNER);
    setCompleteResult(null);
    navigate('/practice');
  }, [navigate, stopTimer]);

  useEffect(() => {
    if (!slug || questions || loadError) return;
    void openSet(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const currentQuestion = questions?.[runner.index] ?? null;
  const advance = useCallback(() => {
    setRunner((r) => {
      const nextIndex = Math.min(r.index + 1, (questions?.length ?? 1) - 1);
      return { ...r, index: nextIndex, phase: 'answering' };
    });
    setRemaining(PER_QUESTION_SECONDS);
  }, [questions]);

  useEffect(() => {
    stopTimer();
    if (!currentQuestion || runner.phase !== 'answering') return;
    timerRef.current = window.setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          stopTimer();
          void handleTimeout();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.index, runner.phase, currentQuestion?.id]);

  async function handleTimeout() {
    if (!currentQuestion || !runner.quizAttemptId) return;
    if (runner.results[currentQuestion.id]) return;
    setRunner((r) => ({ ...r, phase: 'graded' }));
    try {
      const result = await submitPracticeAttempt(
        runner.quizAttemptId,
        currentQuestion.id,
        null,
        true
      );
      if (result.status === 'graded' || result.status === 'already_answered') {
        setRunner((r) => ({
          ...r,
          phase: 'graded',
          answers: { ...r.answers, [currentQuestion.id]: null },
          results: {
            ...r.results,
            [currentQuestion.id]: {
              isCorrect: result.isCorrect ?? false,
              skipped: result.skipped ?? true,
              correctIndex: result.correctIndex ?? 0,
              explanation: result.explanation ?? '',
            },
          },
        }));
        void loadSummary();
      } else {
        setRunner((r) => ({ ...r, phase: 'graded' }));
        setLoadError('Your answer could not be graded. Please try again.');
      }
    } catch {
      setRunner((r) => ({ ...r, phase: 'answering' }));
      setLoadError('Could not reach the grading service. Check your connection.');
    }
  }

  async function choose(index: number) {
    if (!currentQuestion || !runner.quizAttemptId || runner.phase !== 'answering') return;
    stopTimer();
    setRunner((r) => ({ ...r, phase: 'graded' }));
    try {
      const result = await submitPracticeAttempt(
        runner.quizAttemptId,
        currentQuestion.id,
        index,
        false
      );
      if (result.status === 'graded' || result.status === 'already_answered') {
        setRunner((r) => ({
          ...r,
          phase: 'graded',
          answers: { ...r.answers, [currentQuestion.id]: index },
          results: {
            ...r.results,
            [currentQuestion.id]: {
              isCorrect: result.isCorrect ?? false,
              skipped: result.skipped ?? false,
              correctIndex: result.correctIndex ?? 0,
              explanation: result.explanation ?? '',
            },
          },
        }));
        void loadSummary();
      } else {
        setRunner((r) => ({ ...r, phase: 'graded' }));
        setLoadError('Your answer could not be graded. Please try again.');
      }
    } catch {
      setRunner((r) => ({ ...r, phase: 'answering' }));
      setLoadError('Could not reach the grading service. Check your connection.');
    }
  }

  const answeredCount = useMemo(
    () =>
      questions
        ? questions.filter((q) => Boolean(runner.results[q.id])).length
        : 0,
    [questions, runner.results]
  );
  const allAnswered = questions
    ? questions.every((q) => Boolean(runner.results[q.id]))
    : false;

  async function handleFinish() {
    if (!runner.quizAttemptId) return;
    setBusy(true);
    try {
      const res = await finishPracticeAttempt(runner.quizAttemptId);
      setRunner((r) => ({
        ...r,
        finishResult: {
          status: res.status,
          correct: res.correct ?? undefined,
          total: res.total ?? undefined,
          isPassing: res.isPassing ?? undefined,
        },
      }));
      void loadSummary();
    } catch {
      setLoadError('Could not finish your practice attempt. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryFresh() {
    const slug = activeSlugRef.current;
    const id = runner.quizAttemptId;
    if (!slug || !id) return;
    setBusy(true);
    try {
      const abandon = await abandonPracticeAttempt(id);
      if (abandon.status !== 'abandoned') {
        setLoadError('Could not reset your current attempt. Please refresh and try again.');
        return;
      }
      await openSet(slug);
    } catch {
      setLoadError('Could not start a fresh attempt. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    const active = summary?.activeMission;
    if (!active || !activeSlugRef.current) return;
    setCompleting(true);
    setCompleteResult(null);
    try {
      const res = await completeMission(active.id);
      setCompleteResult(res);
      // Trigger celebration only on a genuine fresh completion — never on
      // already_completed (which means the mission was completed in a prior
      // session). The ref prevents duplicate celebrations from re-renders.
      if (
        res.status === 'completed' &&
        celebratedMissionRef.current !== active.id
      ) {
        celebratedMissionRef.current = active.id;
        // Check for newly unlocked badges
        try {
          const ach = await fetchAchievements();
          const newBadges = ach.badges.filter(
            (b) => b.earned && !priorBadgesRef.current.has(b.slug)
          );
          if (newBadges.length > 0) {
            setUnlockedBadges(newBadges);
            priorBadgesRef.current = new Set(
              ach.badges.filter((b) => b.earned).map((b) => b.slug)
            );
          }
        } catch {
          // Badge check failure should not block celebration
        }
        setShowCelebration(true);
        setAlreadyCompleted(false);
      } else if (res.status === 'already_completed') {
        setAlreadyCompleted(true);
      }
      await loadSummary();
    } catch {
      setCompleteResult({ status: 'error' });
    } finally {
      setCompleting(false);
    }
  }

  function closeCelebration() {
    setShowCelebration(false);
  }

  // ---- Render: runner ----

  if (questions && currentQuestion) {
    const chosen = runner.answers[currentQuestion.id];
    const result = runner.results[currentQuestion.id];
    const timeUp = runner.phase === 'answering' && remaining === 0;
    const finished = runner.finishResult?.status === 'completed';
    const passed = runner.finishResult?.isPassing === true;
    const failed = runner.finishResult?.status === 'completed' && !passed;

    return (
      <div className="animate-fade-up mx-auto max-w-3xl">
        <SetHeader slug={activeSlugRef.current ?? 'photosynthesis'} onBack={backToList} />

        {runner.attemptNumber && runner.attemptNumber > 1 && (
          <p className="mt-4 rounded-xl bg-accent-soft/60 px-3.5 py-2 text-xs text-accent-strong" role="status">
            Attempt {runner.attemptNumber} — your prior attempts are preserved. Your score is graded from this attempt only.
          </p>
        )}

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span>
              Question {runner.index + 1} of {questions.length}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {timeUp ? "Time's up" : formatClock(remaining)}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
            role="progressbar"
            aria-valuenow={Math.round((answeredCount / questions.length) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.round((answeredCount / questions.length) * 100)}%` }}
            />
          </div>
        </div>

        <section className="mt-5 rounded-2xl border border-line bg-raised p-5 shadow-sm sm:p-7">
          <p className="font-display text-lg font-bold leading-snug text-ink sm:text-xl">
            {currentQuestion.prompt}
          </p>
          <div className="mt-5 space-y-2" role="radiogroup" aria-label="Answer options">
            {currentQuestion.options.map((opt, i) => {
              const isChosen = result && chosen === i;
              const isRight = result && result.correctIndex === i;
              const reveal = runner.phase === 'graded' && result;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={isChosen ? 'true' : 'false'}
                  disabled={runner.phase !== 'answering'}
                  onClick={() => void choose(i)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    !reveal
                      ? 'border-line hover:border-accent/50 hover:bg-accent-soft/40'
                      : isRight
                        ? 'border-green-300 bg-green-50 text-green-900'
                        : isChosen
                          ? 'border-red-300 bg-red-50 text-red-900'
                          : 'border-line opacity-60'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                      reveal && isRight
                        ? 'border-green-400 bg-green-100 text-green-800'
                        : reveal && isChosen
                          ? 'border-red-400 bg-red-100 text-red-800'
                          : 'border-line-strong text-ink-soft'
                    }`}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="min-w-0 flex-1">{opt}</span>
                </button>
              );
            })}
          </div>

          {result && <Feedback question={currentQuestion} result={result} />}

          {timeUp && !result && (
            <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="status">
              Time ran out for this one — it counts as missed. Move on and keep pace.
            </p>
          )}

          {finished && (
            <div
              className={`mt-6 rounded-2xl border p-5 ${
                passed ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
              }`}
              role="status"
            >
              <p className={`font-display text-lg font-bold ${passed ? 'text-green-800' : 'text-amber-800'}`}>
                {passed ? 'Practice passed' : 'Practice completed — under 80%'}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Scored {runner.finishResult?.correct}/{runner.finishResult?.total} on attempt {runner.attemptNumber}.
              </p>
              {!passed && (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="primary" onClick={() => void handleRetryFresh()} loading={busy}>
                    <RotateCw className="h-4 w-4" aria-hidden />
                    Start a fresh attempt
                  </Button>
                  <Button variant="ghost" onClick={backToList}>
                    Back to practice
                  </Button>
                </div>
              )}
            </div>
          )}

          {!finished && (
            <div className="mt-6 flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={runner.index === 0}
                onClick={() =>
                  setRunner((r) => ({ ...r, index: Math.max(0, r.index - 1), phase: 'answering' }))
                }
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Previous
              </Button>
              {runner.index < questions.length - 1 ? (
                <Button onClick={advance} disabled={runner.phase === 'answering' && !timeUp && !result}>
                  Next question
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : allAnswered ? (
                <Button variant="secondary" onClick={() => void handleFinish()} loading={busy}>
                  <Trophy className="h-4 w-4" aria-hidden />
                  Finish & grade
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setRunner((r) => ({ ...r, index: r.index }))}>
                  Remaining questions
                </Button>
              )}
            </div>
          )}
        </section>
        {loadError && (
          <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
            {loadError}
          </p>
        )}
        {failed && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800" role="note">
            You can retry as many times as you need. Each attempt is graded honestly and stored separately.
          </p>
        )}
      </div>
    );
  }

  if (questions && !currentQuestion) {
    return (
      <div className="animate-fade-up mx-auto max-w-3xl">
        <SetHeader slug={activeSlugRef.current ?? 'photosynthesis'} onBack={backToList} />
        <p className="mt-6 text-sm text-ink-soft">Practice set finished or unavailable.</p>
      </div>
    );
  }

  // ---- Landing: sets + mistakes + summary ----
  const set = AVAILABLE_SETS[0];
  const acc = summary ? accuracy(summary.correct, summary.attempts) : null;

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <p className="text-sm font-medium text-accent">Practice</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
        Prove what you learned.
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
        Timed practice on foundational topics. Every attempt is graded on the
        server and saved, so your results are real. Miss the bar? You can
        retry — each attempt is graded on its own.
      </p>

      {loadError && (
        <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {loadError}
        </p>
      )}

      <section aria-label="Practice sets" className="mt-7">
        <h2 className="font-display text-base font-bold text-ink">Question sets</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          {set.blurb} Human-written questions, reviewed for accuracy by our
          team. Imported videos do not automatically get quizzes — coverage
          grows honestly, set by set.
        </p>
        <ul className="mt-3 space-y-2">
          <li>
            <button
              type="button"
              onClick={() => void openSet(set.slug)}
              disabled={busy}
              className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-raised p-5 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-md disabled:opacity-60"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                <BookOpenCheck className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{set.label}</span>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
                    Reviewed
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {set.subject} · 10 questions · 30s each
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </li>
        </ul>
      </section>

      <MissionCreator
        mission={summary?.activeMission ?? null}
        defaultSlug={set.slug}
        onCreated={(m) =>
          setSummary((s) => ({
            ...(s ?? parsePracticeSummary({})),
            activeMission: m,
            missionsActive: (s?.missionsActive ?? 0) + 1,
          }))
        }
        onStartPractice={(slug) => void openSet(slug)}
      />
      <MissionCompleteCard
        completing={completing}
        result={completeResult}
        mission={summary?.activeMission ?? null}
        alreadyCompleted={alreadyCompleted}
        onComplete={handleComplete}
        onDismiss={() => setCompleteResult(null)}
        onOpenLesson={(rid) => navigate(`/study/${rid}`)}
      />

      {showCelebration && summary?.activeMission && completeResult?.status === 'completed' && (
        <MissionCelebration
          mission={summary.activeMission}
          data={{
            correct: completeResult.correct ?? 0,
            total: completeResult.total ?? 0,
            attemptNumber: completeResult.attemptNumber,
          }}
          unlockedBadges={unlockedBadges}
          onClose={closeCelebration}
          onReviewMistakes={() => {
            closeCelebration();
            // Scroll to mistakes section if present; otherwise stay
          }}
          onGoDashboard={() => {
            closeCelebration();
            navigate('/dashboard');
          }}
          onContinueLearning={() => {
            closeCelebration();
            setUnlockedBadges([]);
            if (summary.activeMission?.resourceId) {
              navigate(`/study/${summary.activeMission.resourceId}`);
            } else {
              backToList();
            }
          }}
          hasLinkedLesson={Boolean(summary.activeMission?.resourceId)}
        />
      )}

      {summary && (
        <section className="mt-8 rounded-2xl border border-line bg-raised p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <Trophy className="h-4 w-4 text-ink-faint" aria-hidden />
            Your practice record
          </h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-faint">Missions completed</dt>
              <dd className="mt-0.5 text-xl font-bold text-ink">{summary.missionsCompleted}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Answers graded</dt>
              <dd className="mt-0.5 text-xl font-bold text-ink">{summary.attempts}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Accuracy</dt>
              <dd className="mt-0.5 text-xl font-bold text-ink">
                {acc !== null ? `${Math.round(acc * 100)}%` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Active days (14d)</dt>
              <dd className="mt-0.5 text-xl font-bold text-ink">{summary.activeDays.length}</dd>
            </div>
          </dl>
          {summary.lastAttempt && (
            <p className="mt-4 text-xs text-ink-soft">
              Last attempt: {summary.lastAttempt.topicSlug} #{summary.lastAttempt.attemptNumber} —{' '}
              {summary.lastAttempt.status === 'completed'
                ? `${summary.lastAttempt.correct}/${summary.lastAttempt.total}${
                    summary.lastAttempt.isPassing ? ' (passed)' : ' (under 80%)'
                  }`
                : summary.lastAttempt.status}
            </p>
          )}
        </section>
      )}

      {summary && summary.mistakes.length > 0 && (
        <section aria-label="Review your mistakes" className="mt-8">
          <h2 className="font-display text-base font-bold text-ink">Review your mistakes</h2>
          <ul className="mt-3 space-y-3">
            {summary.mistakes.map((m) => (
              <MistakeCard
                key={m.questionId}
                mistake={m}
                onRetry={() => void openSet(m.topicSlug || 'photosynthesis')}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
