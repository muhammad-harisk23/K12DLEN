import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Loader2,
  Send,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  startPaperExam,
  getPaperExamAttempt,
  saveExamAnswer,
  submitPaperExam,
  formatDuration,
} from '@/lib/paperExam';
import type { AttemptBundle } from '@/lib/paperExam';
import { ExamError } from '@/lib/paperExam';
import type { StudentProfile } from '@/types/curriculum';

interface ExamRunnerPageProps {
  profile: StudentProfile;
  examId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bundle: AttemptBundle };

type AnswerMap = Record<string, { selectedIndex: number | null; answerText: string; marked: boolean }>;

export function ExamRunnerPage({ profile, examId }: ExamRunnerPageProps) {
  void profile;
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start + load attempt
  const init = useCallback(async () => {
    try {
      const startResult = await startPaperExam(examId);
      const bundle = await getPaperExamAttempt(startResult.attemptId);
      const am: AnswerMap = {};
      for (const q of bundle.questions) {
        am[q.id] = {
          selectedIndex: q.answer?.selected_index ?? null,
          answerText: q.answer?.answer_text ?? '',
          marked: q.answer?.marked_for_review ?? false,
        };
      }
      setAnswers(am);
      setLoad({ status: 'ready', bundle });
    } catch (err) {
      setLoad({
        status: 'error',
        message: err instanceof ExamError ? err.message : 'Could not start the exam.',
      });
    }
  }, [examId]);

  useEffect(() => { void init(); }, [init]);

  // Countdown timer
  useEffect(() => {
    if (load.status !== 'ready') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [load.status]);

  const bundle = load.status === 'ready' ? load.bundle : null;
  const attempt = bundle?.attempt;
  const questions = bundle?.questions ?? [];
  const exam = bundle?.exam;

  const isFinished = attempt?.status === 'submitted' || attempt?.status === 'expired';

  // Timer calculation
  const remainingMs = useMemo(() => {
    if (!attempt?.expires_at) return null;
    return Math.max(0, new Date(attempt.expires_at).getTime() - now);
  }, [attempt?.expires_at, now]);

  const remainingSeconds = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;

  // Auto-submit on expiry (client-side trigger; server is authoritative)
  useEffect(() => {
    if (remainingSeconds === 0 && !submitting && !isFinished) {
      void handleSubmit();
    }
  }, [remainingSeconds]);

  // Debounced answer save
  const scheduleSave = useCallback((qid: string) => {
    if (isFinished) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveAnswer(qid);
    }, 800);
  }, [isFinished]);

  async function saveAnswer(qid: string) {
    if (!bundle || isFinished) return;
    const ans = answers[qid];
    if (!ans) return;
    setSaving(true);
    try {
      await saveExamAnswer({
        attemptId: bundle.attempt.id,
        examQuestionId: qid,
        selectedIndex: ans.selectedIndex,
        answerText: ans.answerText || null,
        markedForReview: ans.marked,
      });
    } catch (err) {
      setError(err instanceof ExamError ? err.message : 'Could not save answer.');
    } finally {
      setSaving(false);
    }
  }

  function updateAnswer(qid: string, patch: Partial<AnswerMap[string]>) {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: { ...prev[qid], ...patch } };
      return next;
    });
    scheduleSave(qid);
  }

  async function handleSubmit() {
    if (!bundle || submitting || isFinished) return;
    setSubmitting(true);
    setError(null);
    try {
      // Save current answer first
      const currentQ = questions[currentIdx];
      if (currentQ) await saveAnswer(currentQ.id);

      await submitPaperExam(bundle.attempt.id);
      navigate(`/papers/exams/attempts/${bundle.attempt.id}/results`);
    } catch (err) {
      setError(err instanceof ExamError ? err.message : 'Could not submit the exam.');
      // If expired on server, redirect to results
      if (err instanceof ExamError && /expired|no longer/i.test(err.message)) {
        try {
          const fresh = await getPaperExamAttempt(bundle.attempt.id);
          if (fresh.attempt.status !== 'in_progress') {
            navigate(`/papers/exams/attempts/${bundle.attempt.id}/results`);
            return;
          }
        } catch { /* ignore */ }
      }
    } finally {
      setSubmitting(false);
    }
  }
  if (load.status === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" aria-label="Loading" />
          <p className="mt-2 text-sm text-ink-soft">Starting your exam…</p>
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-bold text-ink">Could not start</h1>
        <p className="mt-2 text-sm text-ink-soft">{load.message}</p>
        <Link to="/papers" className="mt-5 inline-block text-sm font-medium text-accent hover:text-accent-strong">
          Back to papers
        </Link>
      </div>
    );
  }

  // If already finished, redirect to results
  if (isFinished) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-8 w-8 text-accent" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-bold text-ink">
          {attempt?.status === 'expired' ? 'Time expired' : 'Exam submitted'}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">This exam has been finalized.</p>
        <Button
          variant="primary"
          className="mt-5"
          onClick={() => navigate(`/papers/exams/attempts/${attempt!.id}/results`)}
        >
          View results
        </Button>
      </div>
    );
  }

  const currentQ = questions[currentIdx];
  const answeredCount = Object.values(answers).filter((a) => a.selectedIndex != null || a.answerText.trim()).length;
  const markedCount = Object.values(answers).filter((a) => a.marked).length;

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header bar */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-raised px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-bold text-ink sm:text-lg">{exam?.title}</h1>
          <p className="text-xs text-ink-faint">
            {questions.length} questions · {answeredCount} answered · {markedCount} marked
          </p>
        </div>
        {remainingSeconds != null && (
          <div className={`flex items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-sm font-bold tabular-nums ${
            remainingSeconds <= 30 ? 'border border-line-strong bg-sunken text-ink' : remainingSeconds <= 60 ? 'border border-line bg-sunken text-ink-soft' : 'bg-sunken text-ink'
          }`}>
            <Clock className="h-4 w-4" aria-hidden />
            {formatDuration(remainingSeconds)}
          </div>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
          {error}
          {saving && <span className="ml-2 text-ink-faint">· Saving answer…</span>}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        {/* Question area */}
        <div className="order-1 sm:order-none">
          {currentQ && (
            <div className="rounded-2xl border border-line bg-raised p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-text">
                    {currentIdx + 1}
                  </span>
                  {currentQ.marks != null && (
                    <span className="text-xs font-medium text-ink-faint">[{currentQ.marks} marks]</span>
                  )}
                  <span className="text-[11px] text-ink-faint capitalize">
                    {currentQ.question_type.replace('_', ' ')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => updateAnswer(currentQ.id, { marked: !answers[currentQ.id]?.marked })}
                  className={`flex min-h-touch items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    answers[currentQ.id]?.marked ? 'bg-sunken text-ink-soft' : 'text-ink-faint hover:bg-sunken'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden />
                  {answers[currentQ.id]?.marked ? 'Marked' : 'Mark for review'}
                </button>
              </div>

              {currentQ.has_figure && (
                <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-ink-soft">
                  {currentQ.figure_note ?? 'This question references a figure.'}
                </p>
              )}

              <p className="mt-3 text-sm leading-relaxed text-ink sm:text-base">
                {currentQ.question_text}
              </p>

              {/* Answer input */}
              <div className="mt-4">
                {currentQ.question_type === 'mcq' && currentQ.options && (
                  <ul className="space-y-2">
                    {currentQ.options.map((opt, i) => {
                      const selected = answers[currentQ.id]?.selectedIndex === i;
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => updateAnswer(currentQ.id, { selectedIndex: i })}
                            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                              selected ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface hover:border-line-strong'
                            }`}
                          >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                              selected ? 'border-accent bg-accent text-accent-text' : 'border-line-strong text-ink-faint'
                            }`}>
                              {String.fromCharCode(65 + i)}
                            </span>
                            <span className="text-sm text-ink">{opt}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {(currentQ.question_type === 'short_answer' || currentQ.question_type === 'fill_blank') && (
                  <input
                    type="text"
                    value={answers[currentQ.id]?.answerText ?? ''}
                    onChange={(e) => updateAnswer(currentQ.id, { answerText: e.target.value })}
                    placeholder="Type your answer"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                )}

                {currentQ.question_type === 'long_answer' && (
                  <textarea
                    value={answers[currentQ.id]?.answerText ?? ''}
                    onChange={(e) => updateAnswer(currentQ.id, { answerText: e.target.value })}
                    rows={6}
                    placeholder="Type your answer"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                )}

                {currentQ.question_type === 'true_false' && (
                  <div className="flex gap-2">
                    {['True', 'False'].map((label, i) => {
                      const selected = answers[currentQ.id]?.selectedIndex === i;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => updateAnswer(currentQ.id, { selectedIndex: i })}
                          className={`flex-1 rounded-xl border p-3 text-sm font-medium transition-colors ${
                            selected ? 'border-accent bg-accent-soft/40 text-accent-strong' : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQ.question_type === 'unknown' && (
                  <textarea
                    value={answers[currentQ.id]?.answerText ?? ''}
                    onChange={(e) => updateAnswer(currentQ.id, { answerText: e.target.value })}
                    rows={4}
                    placeholder="Type your answer"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                )}
              </div>

              {/* Nav controls */}
              <div className="mt-5 flex items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                  {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  {saving ? 'Saving…' : 'Saved'}
                </div>
                {currentIdx < questions.length - 1 ? (
                  <Button
                    variant="secondary"
                    onClick={() => { void saveAnswer(currentQ.id); setCurrentIdx((i) => Math.min(questions.length - 1, i + 1)); }}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => setShowSubmitConfirm(true)}
                    disabled={submitting}
                  >
                    <Send className="h-4 w-4" />
                    Submit
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Question navigator */}
        <div className="order-2 sm:order-none">
          <div className="rounded-2xl border border-line bg-raised p-3 shadow-sm">
            <p className="mb-2 text-xs font-semibold text-ink-soft">Navigator</p>
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-4">
              {questions.map((q, i) => {
                const ans = answers[q.id];
                const isAnswered = ans?.selectedIndex != null || (ans?.answerText?.trim() ?? '').length > 0;
                const isMarked = ans?.marked;
                const isCurrent = i === currentIdx;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => { if (currentQ) void saveAnswer(currentQ.id); setCurrentIdx(i); }}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                      isCurrent ? 'ring-2 ring-accent ring-offset-1' : ''
                    } ${
                      isMarked ? 'bg-sunken text-ink-soft' :
                      isAnswered ? 'bg-accent-soft text-accent-strong' :
                      'bg-sunken text-ink-faint'
                    }`}
                    title={`Question ${i + 1}${isMarked ? ' (marked)' : isAnswered ? ' (answered)' : ''}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-ink-faint">
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-accent-soft" /> Answered</p>
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded border border-line bg-sunken" /> Marked</p>
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-sunken" /> Not answered</p>
            </div>
            <Button
              variant="primary"
              className="mt-3 w-full !text-xs"
              disabled={submitting}
              onClick={() => setShowSubmitConfirm(true)}
            >
              <Send className="h-3.5 w-3.5" />
              Submit exam
            </Button>
          </div>
        </div>
      </div>

      {/* Submit confirmation */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 animate-fade-in" onClick={() => setShowSubmitConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-raised p-6 shadow-xl animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-bold text-ink">Submit exam?</h2>
            <p className="mt-2 text-sm text-ink-soft">
              You've answered {answeredCount} of {questions.length} questions.
              {answeredCount < questions.length && ` ${questions.length - answeredCount} unanswered.`}
              This cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowSubmitConfirm(false)}>
                Keep going
              </Button>
              <Button variant="primary" className="flex-1" loading={submitting} onClick={() => void handleSubmit()}>
                Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
