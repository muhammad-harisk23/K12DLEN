import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  fetchPaperUpload,
  fetchPaperQuestions,
  updatePaperQuestion,
  effectiveText,
  effectiveOptions,
  PaperUploadError,
} from '@/lib/paperToPractice';
import type { PaperUpload, PaperQuestion } from '@/lib/paperToPractice';
import type { StudentProfile } from '@/types/curriculum';

interface PaperReviewPageProps {
  profile: StudentProfile;
  uploadId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'missing' }
  | { status: 'ready'; upload: PaperUpload };

type QuestionState = {
  question: PaperQuestion;
  editing: boolean;
  editText: string;
  editOptions: string;
  answerKey: string;
  saving: boolean;
  expanded: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  mcq: 'Multiple choice',
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  fill_blank: 'Fill in the blank',
  true_false: 'True / False',
  unknown: 'Unknown type',
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-accent-soft text-accent-strong',
  medium: 'bg-amber-50 text-amber-800',
  low: 'bg-red-50 text-red-700',
};

export function PaperReviewPage({ profile, uploadId }: PaperReviewPageProps) {
  void profile;
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [questions, setQuestions] = useState<QuestionState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadAll = useCallback(async () => {
    if (!uploadId) {
      setLoad({ status: 'missing' });
      return;
    }
    try {
      const upload = await fetchPaperUpload(uploadId);
      if (!upload) {
        setLoad({ status: 'missing' });
        return;
      }
      if (upload.status !== 'extracted') {
        setLoad({ status: 'denied' });
        return;
      }
      setLoad({ status: 'ready', upload });
      const qs = await fetchPaperQuestions(uploadId);
      setQuestions(
        qs.map((q) => ({
          question: q,
          editing: false,
          editText: effectiveText(q),
          editOptions: (effectiveOptions(q) ?? []).join('\n'),
          answerKey: q.answer_key ?? '',
          saving: false,
          expanded: q.extraction_confidence !== 'high' || q.has_figure,
        }))
      );
    } catch (err) {
      setError(err instanceof PaperUploadError ? err.message : 'Could not load the paper.');
      setLoad({ status: 'missing' });
    }
  }, [uploadId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function updateState(id: string, patch: Partial<QuestionState>) {
    setQuestions((prev) => prev.map((s) => (s.question.id === id ? { ...s, ...patch } : s)));
  }

  async function saveEdit(id: string) {
    const state = questions.find((s) => s.question.id === id);
    if (!state) return;
    updateState(id, { saving: true });
    try {
      const editedText = state.editText.trim() !== state.question.question_text.trim()
        ? state.editText.trim()
        : null;
      const origOpts = state.question.options ?? [];
      const newOpts = state.editOptions.split('\n').map((o) => o.trim()).filter(Boolean);
      const editedOptions = JSON.stringify(newOpts) !== JSON.stringify(origOpts) ? newOpts : null;

      await updatePaperQuestion(id, {
        review_status: editedText || editedOptions ? 'edited' : 'confirmed',
        edited_text: editedText,
        edited_options: editedOptions,
      });
      updateState(id, { editing: false, saving: false });
      // Refresh the question data
      void loadAll();
    } catch (err) {
      updateState(id, { saving: false });
      setError(err instanceof PaperUploadError ? err.message : 'Could not save the edit.');
    }
  }

  async function saveAnswerKey(id: string) {
    const state = questions.find((s) => s.question.id === id);
    if (!state) return;
    updateState(id, { saving: true });
    try {
      const key = state.answerKey.trim();
      await updatePaperQuestion(id, {
        answer_key: key || null,
        answer_key_source: key ? 'student' : 'none',
        review_status: 'confirmed',
      });
      updateState(id, { saving: false });
      void loadAll();
    } catch (err) {
      updateState(id, { saving: false });
      setError(err instanceof PaperUploadError ? err.message : 'Could not save the answer key.');
    }
  }

  async function removeQuestion(id: string) {
    updateState(id, { saving: true });
    try {
      await updatePaperQuestion(id, { review_status: 'removed' });
      void loadAll();
    } catch (err) {
      updateState(id, { saving: false });
      setError(err instanceof PaperUploadError ? err.message : 'Could not remove the question.');
    }
  }

  async function confirmAll() {
    setConfirming(true);
    setError(null);
    try {
      const pending = questions.filter((s) => s.question.review_status === 'pending');
      for (const s of pending) {
        await updatePaperQuestion(s.question.id, { review_status: 'confirmed' });
      }
      void loadAll();
    } catch (err) {
      setError(err instanceof PaperUploadError ? err.message : 'Could not confirm questions.');
    } finally {
      setConfirming(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  if (load.status === 'missing' || load.status === 'denied') {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-bold text-ink">Paper not found</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {load.status === 'denied'
            ? 'This paper has not been processed yet, or you do not have access to it.'
            : 'This paper does not exist or you do not have access to it.'}
        </p>
        <Link
          to="/papers"
          className="mt-5 flex min-h-touch items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
        >
          Back to Paper to Practice
        </Link>
      </div>
    );
  }

  const activeQuestions = questions.filter((s) => s.question.review_status !== 'removed');
  const pendingCount = activeQuestions.filter((s) => s.question.review_status === 'pending').length;
  const confirmedCount = activeQuestions.filter(
    (s) => s.question.review_status === 'confirmed' || s.question.review_status === 'edited'
  ).length;
  const withAnswerKey = activeQuestions.filter((s) => s.question.answer_key).length;
  const withFigure = activeQuestions.filter((s) => s.question.has_figure).length;

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
        <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">
          Review extracted questions
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {load.upload.original_filename}
          {load.upload.page_count ? ` · ${load.upload.page_count} pages` : ''}
        </p>
      </header>

      {/* Summary */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-ink">{activeQuestions.length}</p>
          <p className="text-xs text-ink-faint">Questions</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-accent">{confirmedCount}</p>
          <p className="text-xs text-ink-faint">Confirmed</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className="font-display text-2xl font-bold text-ink">{withAnswerKey}</p>
          <p className="text-xs text-ink-faint">With answer key</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-3 text-center">
          <p className={`font-display text-2xl font-bold ${withFigure > 0 ? 'text-amber-600' : 'text-ink'}`}>
            {withFigure}
          </p>
          <p className="text-xs text-ink-faint">With figures</p>
        </div>
      </section>

      {load.upload.detection_message && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800" role="status">
          {load.upload.detection_message}
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* Question list */}
      <ul className="space-y-3">
        {activeQuestions.map((state, idx) => {
          const q = state.question;
          const text = state.editing ? state.editText : effectiveText(q);
          const opts = state.editing
            ? state.editOptions.split('\n').map((o) => o.trim()).filter(Boolean)
            : effectiveOptions(q);
          const isRemoved = q.review_status === 'removed';

          if (isRemoved) return null;

          return (
            <li
              key={q.id}
              className="rounded-2xl border border-line bg-raised p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-soft">
                    {idx + 1}
                  </span>
                  <span className="text-[11px] font-medium text-ink-faint">
                    {TYPE_LABELS[q.question_type] ?? q.question_type}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLES[q.extraction_confidence]}`}>
                    {q.extraction_confidence} confidence
                  </span>
                  {q.marks != null && (
                    <span className="text-[11px] text-ink-faint">[{q.marks} marks]</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {q.review_status === 'confirmed' || q.review_status === 'edited' ? (
                    <span className="flex items-center gap-0.5 text-[11px] font-medium text-accent-strong">
                      <Check className="h-3 w-3" aria-hidden />
                      {q.review_status === 'edited' ? 'Edited' : 'Confirmed'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-ink-faint">Pending</span>
                  )}
                  <button
                    type="button"
                    onClick={() => updateState(q.id, { expanded: !state.expanded })}
                    className="flex min-h-touch items-center rounded-lg p-1 text-ink-faint hover:text-ink"
                    title={state.expanded ? 'Collapse' : 'Expand'}
                  >
                    {state.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {q.section_label && (
                <p className="mt-2 text-xs font-semibold text-accent">{q.section_label}</p>
              )}

              {q.instruction_text && (
                <p className="mt-1 text-xs italic text-ink-faint">{q.instruction_text}</p>
              )}

              {/* Question text */}
              {state.editing ? (
                <textarea
                  value={state.editText}
                  onChange={(e) => updateState(q.id, { editText: e.target.value })}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-ink">{text}</p>
              )}

              {/* Options */}
              {state.editing ? (
                <textarea
                  value={state.editOptions}
                  onChange={(e) => updateState(q.id, { editOptions: e.target.value })}
                  rows={Math.max(2, opts?.length ?? 0)}
                  placeholder="One option per line"
                  className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              ) : opts && opts.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {opts.map((opt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line text-xs font-medium text-ink-faint">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span>{opt}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Figure warning */}
              {q.has_figure && (
                <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {q.figure_note ?? 'This question references a diagram or figure that could not be extracted from the PDF.'}
                </p>
              )}

              {/* Answer key */}
              {state.expanded && (
                <div className="mt-3 border-t border-line pt-3">
                  <label htmlFor={`answer-key-${q.id}`} className="text-xs font-medium text-ink-soft">
                    Answer key (optional — only if you know the correct answer)
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id={`answer-key-${q.id}`}
                      type="text"
                      value={state.answerKey}
                      onChange={(e) => updateState(q.id, { answerKey: e.target.value })}
                      placeholder={q.question_type === 'mcq' ? 'e.g. A or B' : 'Type the answer you know'}
                      className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                    />
                    <Button
                      variant="secondary"
                      className="!px-3 !py-2 text-xs"
                      disabled={state.saving}
                      onClick={() => void saveAnswerKey(q.id)}
                    >
                      {state.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save key'}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    Answer keys are never fabricated. Only add answers you legitimately know.
                    Questions without answer keys can still be practiced but won't be auto-graded.
                  </p>

                  {/* Action buttons */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {state.editing ? (
                      <>
                        <Button
                          variant="primary"
                          className="!px-3 !py-1.5 text-xs"
                          disabled={state.saving}
                          onClick={() => void saveEdit(q.id)}
                        >
                          {state.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save edit'}
                        </Button>
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5 text-xs"
                          onClick={() => {
                            updateState(q.id, {
                              editing: false,
                              editText: effectiveText(q),
                              editOptions: (effectiveOptions(q) ?? []).join('\n'),
                            });
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5 text-xs"
                          onClick={() => updateState(q.id, { editing: true, expanded: true })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5 text-xs"
                          disabled={state.saving}
                          onClick={() => void removeQuestion(q.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                        {q.review_status === 'pending' && (
                          <Button
                            variant="primary"
                            className="!px-3 !py-1.5 text-xs"
                            onClick={() => void updatePaperQuestion(q.id, { review_status: 'confirmed' }).then(() => void loadAll())}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Confirm
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {activeQuestions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-raised/60 px-6 py-10 text-center">
          <p className="text-sm font-medium text-ink">All questions have been removed</p>
          <p className="mt-1 text-sm text-ink-soft">
            Go back and upload a different paper, or re-extract this one.
          </p>
        </div>
      )}

      {/* Confirm all + create exam */}
      {activeQuestions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-accent/25 bg-raised p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">
                {pendingCount > 0
                  ? `${pendingCount} question${pendingCount === 1 ? '' : 's'} still pending review`
                  : 'All questions reviewed'}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                Confirm remaining questions to create an exam.
              </p>
            </div>
            <Button
              variant="primary"
              disabled={confirming || pendingCount > 0}
              loading={confirming}
              onClick={() => void confirmAll()}
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm all
            </Button>
          </div>
          {pendingCount === 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <Link
                to={`/papers/${uploadId}/exam`}
                className="flex min-h-touch items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
              >
                Create exam from these questions
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 text-center">
        <Link to="/papers" className="text-sm font-medium text-ink-soft hover:text-ink">
          Back to papers
        </Link>
      </div>
    </div>
  );
}
