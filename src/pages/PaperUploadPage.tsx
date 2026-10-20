import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileStack,
  FileText,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  deletePaperUpload,
  extractPaperQuestions,
  fetchPaperUploads,
  PaperUploadError,
  uploadPaperPdf,
} from '@/lib/paperToPractice';
import type { PaperUpload } from '@/lib/paperToPractice';
import type { StudentProfile } from '@/types/curriculum';

interface PaperUploadPageProps {
  profile: StudentProfile;
}

type UploadPhase =
  | { status: 'idle' }
  | { status: 'uploading'; fileName: string }
  | { status: 'processing'; fileName: string; uploadId: string }
  | { status: 'extracted'; fileName: string; uploadId: string; questionCount: number }
  | { status: 'rejected'; fileName: string; message: string }
  | { status: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'extracted':
      return { label: 'Ready to review', className: 'bg-accent-soft text-accent-strong' };
    case 'processing':
      return { label: 'Processing', className: 'border border-line bg-sunken text-ink-soft' };
    case 'rejected':
      return { label: 'No questions found', className: 'border border-line-strong bg-sunken text-ink' };
    case 'failed':
      return { label: 'Failed', className: 'border border-line-strong bg-sunken text-ink' };
    default:
      return { label: 'Uploaded', className: 'bg-sunken text-ink-soft' };
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function PaperUploadPage({ profile }: PaperUploadPageProps) {
  void profile;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>({ status: 'idle' });
  const [uploads, setUploads] = useState<PaperUpload[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const loadUploads = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await fetchPaperUploads();
      setUploads(list);
    } catch {
      setListError('Could not load your uploaded papers.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  async function handleFile(file: File) {
    setPhase({ status: 'uploading', fileName: file.name });
    try {
      const { upload } = await uploadPaperPdf(file);
      setPhase({ status: 'processing', fileName: file.name, uploadId: upload.id });
      const result = await extractPaperQuestions(upload.id);
      if (result.status === 'extracted') {
        setPhase({
          status: 'extracted',
          fileName: file.name,
          uploadId: upload.id,
          questionCount: result.questionCount ?? 0,
        });
      } else {
        setPhase({
          status: 'rejected',
          fileName: file.name,
          message: result.message ?? 'This document does not appear to contain exam questions.',
        });
      }
      void loadUploads();
    } catch (err) {
      const msg = err instanceof PaperUploadError
        ? err.message
        : 'Could not process the file. Please try again.';
      setPhase({ status: 'error', message: msg });
      void loadUploads();
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function handleDelete(upload: PaperUpload) {
    setDeletingId(upload.id);
    setConfirmDeleteId(null);
    try {
      await deletePaperUpload(upload.id, `${upload.owner_id}/${upload.id}.pdf`);
      setUploads((prev) => prev.filter((u) => u.id !== upload.id));
    } catch {
      setListError('Could not delete the paper.');
    } finally {
      setDeletingId(null);
    }
  }

  const processing = phase.status === 'uploading' || phase.status === 'processing';
  const hasUploads = uploads.length > 0;

  return (
    <div className="animate-fade-up mx-auto max-w-4xl">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
            <FileText className="h-5 w-5 text-accent-strong" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Paper to Practice</h1>
            <p className="text-sm text-ink-soft">
              Upload a question paper PDF. We extract the real questions so you can practice them.
            </p>
          </div>
        </div>
      </header>

      {/* Two-column layout: upload + papers list */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">

        {/* ===== Left: Upload zone ===== */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative flex flex-col rounded-2xl border-2 border-dashed p-6 transition-all sm:p-7 ${
            dragOver
              ? 'border-accent bg-accent-soft/30 scale-[1.01]'
              : 'border-line-strong bg-raised'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={onFileSelected}
            className="sr-only"
            id="paper-upload-input"
          />

          {phase.status === 'idle' && (
            <>
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-transform ${dragOver ? 'bg-accent scale-110' : 'bg-accent-soft'}`}>
                  <Upload className={`h-7 w-7 transition-colors ${dragOver ? 'text-accent-text' : 'text-accent-strong'}`} aria-hidden />
                </div>
                <p className="mt-4 font-display text-base font-semibold text-ink">
                  {dragOver ? 'Drop to upload' : 'Drop your PDF here'}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  or click to browse
                </p>
              </div>
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="h-4 w-4" aria-hidden />
                Choose PDF
              </Button>
              <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-ink-faint">
                <span>PDF only</span>
                <span className="h-3 w-px bg-line" aria-hidden />
                <span>Up to 15 MB</span>
                <span className="h-3 w-px bg-line" aria-hidden />
                <span>Text-based</span>
              </div>
            </>
          )}

          {phase.status === 'uploading' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft">
                <Loader2 className="h-7 w-7 animate-spin text-accent-strong" aria-hidden />
              </div>
              <p className="mt-4 text-sm font-medium text-ink">Uploading {phase.fileName}…</p>
              <p className="mt-1 text-xs text-ink-faint">Sending your paper securely</p>
            </div>
          )}

          {phase.status === 'processing' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft">
                <Loader2 className="h-7 w-7 animate-spin text-accent-strong" aria-hidden />
              </div>
              <p className="mt-4 text-sm font-medium text-ink">Extracting questions…</p>
              <p className="mt-1 text-xs text-ink-faint">Reading your paper carefully. This takes a few seconds.</p>
              <div className="mt-4 w-full max-w-[200px]">
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full w-full animate-pulse rounded-full bg-accent" style={{ animationDuration: '1.5s' }} />
                </div>
              </div>
            </div>
          )}

          {phase.status === 'extracted' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft">
                <CheckCircle2 className="h-8 w-8 text-accent-strong" aria-hidden />
              </div>
              <p className="mt-4 font-display text-lg font-bold text-ink">
                {phase.questionCount} {phase.questionCount === 1 ? 'question' : 'questions'} found
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Review to make sure they're correct
              </p>
              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={() => navigate(`/papers/${phase.uploadId}/review`)}
              >
                Review questions
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <button
                type="button"
                onClick={() => { setPhase({ status: 'idle' }); fileInputRef.current?.click(); }}
                className="mt-2 text-xs font-medium text-ink-soft transition-colors hover:text-ink"
              >
                Upload another
              </button>
            </div>
          )}

          {phase.status === 'rejected' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sunken">
                <XCircle className="h-8 w-8 text-ink-soft" aria-hidden />
              </div>
              <p className="mt-4 font-display text-base font-semibold text-ink">No questions found</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-soft">
                {phase.message}
              </p>
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => { setPhase({ status: 'idle' }); fileInputRef.current?.click(); }}
              >
                Try a different PDF
              </Button>
            </div>
          )}

          {phase.status === 'error' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sunken">
                <AlertCircle className="h-8 w-8 text-ink" aria-hidden />
              </div>
              <p className="mt-4 font-display text-base font-semibold text-ink">Something went wrong</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-soft">
                {phase.message}
              </p>
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => { setPhase({ status: 'idle' }); fileInputRef.current?.click(); }}
              >
                Try again
              </Button>
            </div>
          )}
        </section>

        {/* ===== Right: Uploaded papers list ===== */}
        <section aria-label="Your uploaded papers" className="flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <FileStack className="h-4 w-4 text-ink-soft" aria-hidden />
              Your papers
              {hasUploads && (
                <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
                  {uploads.length}
                </span>
              )}
            </h2>
          </div>

          {loadingList ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-line bg-raised p-8">
              <Loader2 className="h-5 w-5 animate-spin text-ink-faint" aria-hidden />
            </div>
          ) : !hasUploads ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-sunken/30 p-8 text-center">
              <FileText className="h-8 w-8 text-ink-faint" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink-soft">No papers yet</p>
              <p className="mt-1 text-xs text-ink-faint">
                Upload your first question paper to get started
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {uploads.map((upload) => {
                const badge = statusBadge(upload.status);
                const canReview = upload.status === 'extracted';
                return (
                  <li
                    key={upload.id}
                    className="group flex items-start gap-3 rounded-xl border border-line bg-raised p-3.5 transition-all hover:border-line-strong hover:shadow-card"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken">
                      <FileText className="h-4 w-4 text-ink-soft" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {upload.original_filename}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                        <span>{formatBytes(upload.file_size_bytes)}</span>
                        {upload.page_count && (
                          <>
                            <span className="h-2.5 w-px bg-line" aria-hidden />
                            <span>{upload.page_count} pages</span>
                          </>
                        )}
                        <span className="h-2.5 w-px bg-line" aria-hidden />
                        <span>{timeAgo(upload.created_at)}</span>
                      </p>
                      {upload.detection_message && upload.status === 'rejected' && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">{upload.detection_message}</p>
                      )}
                      {upload.error_message && upload.status === 'failed' && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-ink">{upload.error_message}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                        {canReview && (
                          <button
                            type="button"
                            onClick={() => navigate(`/papers/${upload.id}/review`)}
                            className="flex items-center gap-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:text-ink"
                          >
                            Review
                            <ArrowRight className="h-3 w-3" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {confirmDeleteId === upload.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDelete(upload)}
                            disabled={deletingId === upload.id}
                            className="flex min-h-touch items-center rounded-lg bg-error px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                            aria-label={`Confirm delete ${upload.original_filename}`}
                          >
                            {deletingId === upload.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              'Delete'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="flex min-h-touch items-center rounded-lg px-2 py-1.5 text-[11px] font-medium text-ink-soft transition-colors hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(upload.id)}
                          disabled={deletingId === upload.id || processing}
                          className="flex min-h-touch items-center rounded-lg p-1.5 text-ink-faint transition-all hover:bg-sunken hover:text-ink focus:opacity-100"
                          title="Delete this paper"
                          aria-label={`Delete ${upload.original_filename}`}
                        >
                          {deletingId === upload.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {listError && (
            <p className="mt-3 rounded-xl border border-line-strong bg-sunken px-3 py-2 text-xs font-medium text-ink" role="alert">
              {listError}
            </p>
          )}
        </section>
      </div>

      {/* How it works — compact info strip */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="How it works">
        {[
          { n: '1', title: 'Upload PDF', body: 'Text-based question papers, PYQs, mock tests, worksheets.' },
          { n: '2', title: 'Review questions', body: 'Confirm extracted text, fix errors, add answer keys.' },
          { n: '3', title: 'Practice', body: 'Study your confirmed questions interactively.' },
        ].map((step) => (
          <div key={step.n} className="flex items-start gap-3 rounded-xl border border-line bg-raised p-3.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sunken font-display text-sm font-bold text-ink-soft">
              {step.n}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{step.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Privacy note */}
      <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-faint">
        Your papers stay private — only you can see them. We don't publish or share uploaded documents.
        Scanned image-only PDFs without embedded text aren't supported yet.
      </p>

      <div className="mt-5 text-center">
        <Link to="/dashboard" className="text-sm font-medium text-ink-soft transition-colors hover:text-ink">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
