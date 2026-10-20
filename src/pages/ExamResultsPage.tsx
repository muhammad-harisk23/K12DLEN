import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import { getPaperExamAttempt, formatDuration } from '@/lib/paperExam';
import type { AttemptBundle } from '@/lib/paperExam';
import { ExamError } from '@/lib/paperExam';
import type { StudentProfile } from '@/types/curriculum';

interface ExamResultsPageProps {
  profile: StudentProfile;
  attemptId: string;
}

export function ExamResultsPage({ profile, attemptId }: ExamResultsPageProps) {
  void profile;
  const [bundle, setBundle] = useState<AttemptBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await getPaperExamAttempt(attemptId);
      setBundle(b);
    } catch (err) {
      setError(err instanceof ExamError ? err.message : 'Could not load results.');
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-bold text-ink">Results unavailable</h1>
        <p className="mt-2 text-sm text-ink-soft">{error ?? 'Could not load results.'}</p>
        <Link to="/papers" className="mt-5 inline-block text-sm font-medium text-accent hover:text-accent-strong">
          Back to papers
        </Link>
      </div>
    );
  }

  const { attempt, exam, questions } = bundle;
  const isFinished = attempt.status === 'submitted' || attempt.status === 'expired';
  const scoreCorrect = attempt.score_correct ?? 0;
  const scoreTotal = attempt.score_total ?? 0;
  const gradedCount = attempt.graded_count ?? 0;
  const ungradedCount = attempt.ungraded_count ?? 0;
  const timeUsed = attempt.time_used_seconds ?? 0;
  const answeredCount = questions.filter((q) => q.answer && (q.answer.selected_index != null || q.answer.answer_text?.trim())).length;
  const hasStudentKeys = questions.some((q) => q.answer_key_source === 'student' && q.answer_key);

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <Link
        to="/papers"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to papers
      </Link>

      <header className="mt-3 mb-5">
        <div className="flex items-center gap-2">
          {isFinished ? (
            <CheckCircle2 className="h-6 w-6 text-accent" aria-hidden />
          ) : (
            <Clock className="h-6 w-6 text-ink-soft" aria-hidden />
          )}
          <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">{exam.title}</h1>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {attempt.status === 'submitted' ? 'Submitted' : attempt.status === 'expired' ? 'Time expired' : 'In progress'}
          {timeUsed > 0 && ` · ${formatDuration(timeUsed)} used`}
        </p>
      </header>

      {/* Score summary */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-ink">{answeredCount}</p>
          <p className="text-xs text-ink-faint">Answered</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-accent">{scoreCorrect}</p>
          <p className="text-xs text-ink-faint">Correct (graded)</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-ink">{scoreTotal}</p>
          <p className="text-xs text-ink-faint">Gradeable total</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className={`font-display text-2xl font-bold ${ungradedCount > 0 ? 'text-ink-soft' : 'text-ink'}`}>
            {ungradedCount}
          </p>
          <p className="text-xs text-ink-faint">Ungraded</p>
        </div>
      </section>

      {/* Trust notice */}
      {isFinished && (
        <div className="mb-5 rounded-xl border border-line bg-sunken/40 p-4">
          {gradedCount > 0 && hasStudentKeys && (
            <p className="text-xs leading-relaxed text-ink-soft">
              <strong className="text-ink">Score based on your supplied answer key.</strong> This
              is not an officially verified academic grade. Auto-grading used answer keys you
              entered during review. Verify any unexpected results against your source material.
            </p>
          )}
          {ungradedCount > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              <strong className="text-ink">{ungradedCount} question{ungradedCount === 1 ? '' : 's'} could not be auto-graded</strong>
              {gradedCount > 0 && ' — '}either because no answer key was supplied or the question type
              doesn't support automatic grading. Your submitted answers are saved below for manual review.
            </p>
          )}
          {gradedCount === 0 && ungradedCount > 0 && (
            <p className="text-xs leading-relaxed text-ink-soft">
              No questions could be automatically graded. Your answers are saved below.
              Add answer keys during review to enable auto-grading for future attempts.
            </p>
          )}
        </div>
      )}

      {/* Answer review */}
      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <FileText className="h-4 w-4 text-accent" aria-hidden />
          Answer review
        </h2>
        <ul className="space-y-3">
          {questions.map((q, idx) => {
            const ans = q.answer;
            const correctIndex = parseAnswerKey(q.answer_key, q.options);
            const isGraded = ans?.graded ?? false;
            const isCorrect = ans?.is_correct ?? false;
            const wasAnswered = ans && (ans.selected_index != null || (ans.answer_text?.trim() ?? '').length > 0);

            return (
              <li key={q.id} className="rounded-2xl border border-line bg-raised p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-soft">
                      {idx + 1}
                    </span>
                    {q.marks != null && <span className="text-[11px] text-ink-faint">[{q.marks} marks]</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {isGraded && isCorrect && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-accent-strong">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Correct
                      </span>
                    )}
                    {isGraded && !isCorrect && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-ink">
                        <XCircle className="h-3.5 w-3.5" /> Incorrect
                      </span>
                    )}
                    {!isGraded && wasAnswered && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-ink-soft">
                        <MinusCircle className="h-3.5 w-3.5" /> Ungraded
                      </span>
                    )}
                    {!wasAnswered && (
                      <span className="text-xs font-medium text-ink-faint">Not answered</span>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-ink">{q.question_text}</p>

                {/* Options with answer markers */}
                {q.options && q.options.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {q.options.map((opt, i) => {
                      const isSelected = ans?.selected_index === i;
                      const isCorrectOpt = correctIndex === i && isFinished;
                      return (
                        <li
                          key={i}
                          className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                            isCorrectOpt ? 'bg-accent-soft/50 text-accent-strong' :
                            isSelected && !isCorrectOpt && isGraded ? 'bg-sunken text-ink' :
                            isSelected ? 'bg-sunken text-ink' : 'text-ink-soft'
                          }`}
                        >
                          <span className="font-medium">{String.fromCharCode(65 + i)})</span>
                          <span>{opt}</span>
                          {isCorrectOpt && <CheckCircle2 className="ml-auto h-4 w-4 text-accent" />}
                          {isSelected && !isCorrectOpt && isGraded && <XCircle className="ml-auto h-4 w-4 text-ink" />}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Text answer */}
                {q.answer?.answer_text && (!q.options || q.options.length === 0) && (
                  <div className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
                    <p className="text-[11px] font-medium text-ink-faint">Your answer:</p>
                    <p className="mt-0.5">{q.answer.answer_text}</p>
                  </div>
                )}

                {/* Correct answer for graded MCQ */}
                {isFinished && correctIndex != null && q.options && q.options[correctIndex] && (
                  <p className="mt-2 text-xs text-accent-strong">
                    Correct answer: {String.fromCharCode(65 + correctIndex)}) {q.options[correctIndex]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/papers"
          className="flex min-h-touch items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
        >
          Back to papers
        </Link>
        <Link
          to="/papers"
          className="flex min-h-touch items-center justify-center rounded-xl border border-line bg-raised px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
        >
          Upload another paper
        </Link>
      </div>
    </div>
  );
}

function parseAnswerKey(key: string | null, options: string[] | null): number | null {
  if (!key || !options) return null;
  if (/^[0-9]+$/.test(key)) {
    const idx = parseInt(key, 10);
    return idx >= 0 && idx < options.length ? idx : null;
  }
  if (/^[A-Da-d]$/.test(key)) {
    const idx = key.toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < options.length ? idx : null;
  }
  return null;
}
