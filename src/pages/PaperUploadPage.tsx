import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
  FileStack,
  ArrowRight,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  uploadPaperPdf,
  extractPaperQuestions,
  fetchPaperUploads,
  deletePaperUpload,
  PaperUploadError,
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
      return { label: 'Processing', className: 'bg-amber-50 text-amber-800' };
    case 'rejected':
      return { label: 'No questions found', className: 'bg-red-50 text-red-700' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-50 text-red-700' };
    default:
      return { label: 'Uploaded', className: 'bg-sunken text-ink-soft' };
  }
}

export function PaperUploadPage({ profile }: PaperUploadPageProps) {
  void profile;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>({ status: 'idle' });
  const [uploads, setUploads] = useState<PaperUpload[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const loadUploads = useCallback(async () => {
    try {
      const list = await fetchPaperUploads();
      setUploads(list);
    } catch {
      setListError('Could not load your uploaded papers.');
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

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Paper to Practice</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Upload your own question paper, PYQ, sample paper, mock test or worksheet PDF.
          We'll extract the real questions so you can practice them interactively.
        </p>
      </header>

      {/* Upload dropzone */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${
          dragOver ? 'border-accent bg-accent-soft/30' : 'border-line-strong bg-raised'
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
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
              <Upload className="h-7 w-7 text-accent-strong" aria-hidden />
            </div>
            <p className="mt-4 font-display text-lg font-semibold text-ink">
              Drop your PDF here
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              or click to browse — PDF only, up to 15 MB
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="h-4 w-4" aria-hidden />
              Choose PDF
            </Button>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Your paper stays private — only you can see it. We don't publish or share
              uploaded documents. Questions are extracted from the actual PDF content.
            </p>
          </>
        )}

        {phase.status === 'uploading' && (
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
            <p className="mt-3 text-sm font-medium text-ink">Uploading {phase.fileName}…</p>
          </div>
        )}

        {phase.status === 'processing' && (
          <div className="flex flex-col items-center">
            <div className="relative">
              <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
            </div>
            <p className="mt-3 text-sm font-medium text-ink">
              Reading your paper and extracting questions…
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              This usually takes a few seconds. Please don't close this page.
            </p>
          </div>
        )}

        {phase.status === 'extracted' && (
          <div className="flex flex-col items-center">
            <CheckCircle2 className="h-10 w-10 text-accent" aria-hidden />
            <p className="mt-3 font-display text-lg font-semibold text-ink">
              {phase.questionCount} {phase.questionCount === 1 ? 'question' : 'questions'} extracted
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Please review the extracted questions to make sure they're correct.
            </p>
            <Button
              variant="primary"
              className="mt-5"
              onClick={() => navigate(`/papers/${phase.uploadId}/review`)}
            >
              Review questions
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}

        {phase.status === 'rejected' && (
          <div className="flex flex-col items-center">
            <XCircle className="h-10 w-10 text-amber-600" aria-hidden />
            <p className="mt-3 font-display text-lg font-semibold text-ink">
              No questions found
            </p>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
              {phase.message}
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => { setPhase({ status: 'idle' }); fileInputRef.current?.click(); }}
            >
              Try a different PDF
            </Button>
          </div>
        )}

        {phase.status === 'error' && (
          <div className="flex flex-col items-center">
            <AlertCircle className="h-10 w-10 text-red-600" aria-hidden />
            <p className="mt-3 font-display text-lg font-semibold text-ink">
              Something went wrong
            </p>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
              {phase.message}
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => { setPhase({ status: 'idle' }); fileInputRef.current?.click(); }}
            >
              Try again
            </Button>
          </div>
        )}
      </section>

      {/* Previously uploaded papers */}
      {uploads.length > 0 && (
        <section className="mt-8" aria-label="Your uploaded papers">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <FileStack className="h-4 w-4 text-accent" aria-hidden />
            Your papers
          </h2>
          <ul className="mt-3 space-y-2">
            {uploads.map((upload) => {
              const badge = statusBadge(upload.status);
              return (
                <li
                  key={upload.id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3"
                >
                  <FileText className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {upload.original_filename}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatBytes(upload.file_size_bytes)}
                      {upload.page_count ? ` · ${upload.page_count} pages` : ''}
                      {' · '}{new Date(upload.created_at).toLocaleDateString()}
                    </p>
                    {upload.detection_message && upload.status === 'rejected' && (
                      <p className="mt-1 text-xs text-amber-700">{upload.detection_message}</p>
                    )}
                    {upload.error_message && upload.status === 'failed' && (
                      <p className="mt-1 text-xs text-red-600">{upload.error_message}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  {upload.status === 'extracted' && (
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 text-xs"
                      onClick={() => navigate(`/papers/${upload.id}/review`)}
                    >
                      Review
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDelete(upload)}
                    disabled={deletingId === upload.id || processing}
                    className="flex min-h-touch items-center rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Delete this paper"
                  >
                    {deletingId === upload.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {listError && (
        <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {listError}
        </p>
      )}

      <div className="mt-8 rounded-xl border border-line bg-sunken/50 p-4">
        <p className="text-xs leading-relaxed text-ink-soft">
          <strong className="text-ink">How it works:</strong> Upload a text-based PDF of your
          question paper. We analyze the content to detect genuine exam questions and extract
          them faithfully — including question text, answer options, marks, and section labels.
          You then review and confirm the questions before practicing. We never invent questions
          or answer keys. Scanned image-only PDFs without embedded text are not supported yet.
        </p>
      </div>

      <div className="mt-6 text-center">
        <Link to="/dashboard" className="text-sm font-medium text-ink-soft hover:text-ink">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
