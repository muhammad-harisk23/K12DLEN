import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  FileText,
  Info,
  Loader2,
  PencilLine,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { fetchPaperUpload, fetchPaperQuestions, effectiveText, effectiveOptions } from '@/lib/paperToPractice';
import type { PaperUpload, PaperQuestion } from '@/lib/paperToPractice';
import { createPaperExam } from '@/lib/paperExam';
import type { ExamMode } from '@/lib/paperExam';
import { PaperUploadError } from '@/lib/paperToPractice';
import { ExamError } from '@/lib/paperExam';
import type { StudentProfile } from '@/types/curriculum';

interface ExamConfigurePageProps {
  profile: StudentProfile;
  uploadId: string;
}

export function ExamConfigurePage({ profile, uploadId }: ExamConfigurePageProps) {
  void profile;
  const navigate = useNavigate();

  const [upload, setUpload] = useState<PaperUpload | null>(null);
  const [questions, setQuestions] = useState<PaperQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<ExamMode>('practice');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [instructions, setInstructions] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const u = await fetchPaperUpload(uploadId);
      if (!u) { setLoadError('Paper not found.'); return; }
      if (u.status !== 'extracted') { setLoadError('Paper must be processed first.'); return; }
      setUpload(u);
      const qs = await fetchPaperQuestions(uploadId);
      const usable = qs.filter((q) => q.review_status !== 'removed' && !q.has_figure);
      setQuestions(usable);
      setTitle(u.original_filename.replace(/\.pdf$/i, ''));
      setSelectedIds(new Set(usable.filter((q) => q.review_status !== 'pending').map((q) => q.id)));
    } catch (err) {
      setLoadError(err instanceof PaperUploadError ? err.message : 'Could not load the paper.');
    } finally {
      setLoading(false);
    }
  }, [uploadId]);

  useEffect(() => { void load(); }, [load]);

  const usableQuestions = useMemo(
    () => questions.filter((q) => q.review_status !== 'pending' && !q.has_figure),
    [questions]
  );

  const totalMarks = useMemo(
    () => usableQuestions
      .filter((q) => selectedIds.has(q.id))
      .reduce((sum, q) => sum + (q.marks ?? 0), 0),
    [usableQuestions, selectedIds]
  );

  const withAnswerKey = useMemo(
    () => usableQuestions.filter((q) => selectedIds.has(q.id) && q.answer_key && q.answer_key_source !== 'none').length,
    [usableQuestions, selectedIds]
  );

  const canCreate = selectedIds.size > 0 && title.trim().length > 0 && !creating;

  function toggleQuestion(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(usableQuestions.map((q) => q.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const examId = await createPaperExam({
        uploadId,
        title: title.trim(),
        questionIds: Array.from(selectedIds),
        mode,
        durationMinutes: mode === 'timed' ? durationMinutes : 0,
        instructions: instructions.trim() || undefined,
      });
      navigate(`/papers/exams/${examId}/start`);
    } catch (err) {
      setCreateError(err instanceof ExamError ? err.message : 'Could not create the exam.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
        <h1 className="mt-3 font-display text-lg font-bold text-ink">Cannot configure exam</h1>
        <p className="mt-2 text-sm text-ink-soft">{loadError}</p>
        <Link to="/papers" className="mt-5 inline-block text-sm font-medium text-accent hover:text-accent-strong">
          Back to papers
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <Link
        to={`/papers/${uploadId}/review`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to review
      </Link>

      <header className="mt-3 mb-5">
        <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Configure your exam</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {upload?.original_filename}
        </p>
      </header>

      {createError && (
        <p className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {createError}
        </p>
      )}

      {/* Exam settings */}
      <section className="mb-5 space-y-4 rounded-2xl border border-line bg-raised p-5 shadow-sm">
        <div>
          <label htmlFor="exam-title" className="text-sm font-medium text-ink">Exam title</label>
          <input
            id="exam-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            placeholder="e.g. Science Sample Paper Practice"
          />
        </div>

        <div>
          <span className="text-sm font-medium text-ink">Mode</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('practice')}
              className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-colors ${
                mode === 'practice' ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <PencilLine className="h-4 w-4 text-accent" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">Practice</p>
                <p className="text-[11px] text-ink-faint">No timer — take your time</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('timed')}
              className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-colors ${
                mode === 'timed' ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <Clock className="h-4 w-4 text-accent" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">Timed exam</p>
                <p className="text-[11px] text-ink-faint">Server-enforced deadline</p>
              </div>
            </button>
          </div>
        </div>

        {mode === 'timed' && (
          <div>
            <label htmlFor="duration" className="text-sm font-medium text-ink">Duration (minutes)</label>
            <input
              id="duration"
              type="number"
              min={1}
              max={300}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
              className="mt-1.5 w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-ink-faint">
              The timer starts when you begin and is enforced by the server. Closing the browser does not grant extra time.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="instructions" className="text-sm font-medium text-ink">Instructions (optional)</label>
          <textarea
            id="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            placeholder="Any instructions to show at the start of the exam"
          />
        </div>
      </section>

      {/* Question selection */}
      <section className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <FileText className="h-4 w-4 text-accent" aria-hidden />
            Select questions ({selectedIds.size} of {usableQuestions.length})
          </h2>
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="text-xs font-medium text-accent hover:text-accent-strong">Select all</button>
            <button type="button" onClick={deselectAll} className="text-xs font-medium text-ink-faint hover:text-ink">Deselect all</button>
          </div>
        </div>

        {usableQuestions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-raised/60 p-6 text-center">
            <p className="text-sm text-ink-soft">
              No usable questions. Confirm or fix questions in the review page first.
              Questions with missing figures cannot be included.
            </p>
            <Link to={`/papers/${uploadId}/review`} className="mt-3 inline-block text-sm font-medium text-accent hover:text-accent-strong">
              Go to review
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {usableQuestions.map((q, idx) => {
              const isSelected = selectedIds.has(q.id);
              const opts = effectiveOptions(q);
              const hasKey = q.answer_key && q.answer_key_source !== 'none';
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => toggleQuestion(q.id)}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                      isSelected ? 'border-accent bg-accent-soft/30' : 'border-line bg-raised hover:border-line-strong'
                    }`}
                  >
                    <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      isSelected ? 'border-accent bg-accent text-white' : 'border-line-strong'
                    }`}>
                      {isSelected && <Check className="h-3 w-3" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-ink-faint">Q{idx + 1}</span>
                        {q.marks != null && <span className="text-[11px] text-ink-faint">[{q.marks} marks]</span>}
                        {hasKey ? (
                          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">Has answer key</span>
                        ) : (
                          <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">No answer key</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-ink">{effectiveText(q)}</p>
                      {opts && opts.length > 0 && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">
                          {opts.slice(0, 4).map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('  ')}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Summary + create */}
      {usableQuestions.length > 0 && (
        <section className="sticky bottom-4 z-10 rounded-2xl border border-line bg-raised p-4 shadow-lg sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-ink">
                {selectedIds.size} question{selectedIds.size === 1 ? '' : 's'}
                {totalMarks > 0 && ` · ${totalMarks} marks`}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {withAnswerKey} auto-gradeable · {selectedIds.size - withAnswerKey} will need manual review
              </p>
            </div>
            <Button
              variant="primary"
              disabled={!canCreate}
              loading={creating}
              onClick={() => void handleCreate()}
            >
              Create exam
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-ink-faint">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <p>
              Auto-grading uses answer keys you supplied. Scores from your keys are labeled
              "based on your supplied answer key" — not official grades. Questions without keys
              are saved but remain ungraded until you review them.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
