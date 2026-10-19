import { supabase } from '@/lib/supabase';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ACCEPTED_TYPES = ['application/pdf'];

export type UploadStatus = 'uploaded' | 'processing' | 'extracted' | 'rejected' | 'failed';
export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'fill_blank' | 'true_false' | 'unknown';
export type ExtractionConfidence = 'high' | 'medium' | 'low';
export type ReviewStatus = 'pending' | 'confirmed' | 'edited' | 'removed';
export type AnswerKeySource = 'none' | 'student' | 'extracted';

export interface PaperUpload {
  id: string;
  owner_id: string;
  original_filename: string;
  file_size_bytes: number;
  page_count: number | null;
  status: UploadStatus;
  detection_result: {
    isQuestionPaper?: boolean;
    confidence?: string;
    reason?: string;
    isScanned?: boolean;
    questionCount?: number;
  };
  detection_message: string | null;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface PaperQuestion {
  id: string;
  upload_id: string;
  position: number;
  section_label: string | null;
  question_text: string;
  question_type: QuestionType;
  options: string[] | null;
  marks: number | null;
  instruction_text: string | null;
  extraction_confidence: ExtractionConfidence;
  has_figure: boolean;
  figure_note: string | null;
  answer_key: string | null;
  answer_key_source: AnswerKeySource;
  review_status: ReviewStatus;
  edited_text: string | null;
  edited_options: string[] | null;
}

export interface UploadResult {
  upload: PaperUpload;
}

export interface ExtractResult {
  status: 'extracted' | 'rejected';
  questionCount?: number;
  confidence?: string;
  reason?: string;
  message?: string;
}

export class PaperUploadError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/** Upload a PDF to private storage and create a paper_uploads record. */
export async function uploadPaperPdf(file: File): Promise<UploadResult> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new PaperUploadError('Please upload a PDF file.', 'invalid_type');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new PaperUploadError('The file is too large. PDFs must be 15 MB or smaller.', 'too_large');
  }
  if (file.size === 0) {
    throw new PaperUploadError('The file appears to be empty.', 'empty');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new PaperUploadError('Sign in to upload a paper.', 'unauthenticated');

  const userId = sessionData.session!.user.id;
  const uploadId = crypto.randomUUID();
  const storagePath = `${userId}/${uploadId}.pdf`;

  // Upload to private storage bucket
  const { error: storageErr } = await supabase.storage
    .from('paper-uploads')
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      cacheControl: 'no-cache',
    });

  if (storageErr) {
    throw new PaperUploadError('Could not upload the file. Please try again.', 'storage_error');
  }

  // Create database record
  const { data, error } = await supabase
    .from('paper_uploads')
    .insert({
      id: uploadId,
      storage_path: storagePath,
      original_filename: file.name,
      file_size_bytes: file.size,
    })
    .select('*')
    .single();

  if (error || !data) {
    // Clean up orphaned storage file
    await supabase.storage.from('paper-uploads').remove([storagePath]);
    throw new PaperUploadError('Could not create the upload record. Please try again.', 'db_error');
  }

  return { upload: data as PaperUpload };
}

/** Trigger extraction by calling the paper-extract edge function. */
export async function extractPaperQuestions(uploadId: string): Promise<ExtractResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new PaperUploadError('Sign in to process your paper.', 'unauthenticated');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paper-extract`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ uploadId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Processing failed.' }));
    throw new PaperUploadError(body.error ?? 'Processing failed.', 'extract_error');
  }

  const result = (await res.json()) as ExtractResult;
  return result;
}

/** Fetch all of the current user's uploads. */
export async function fetchPaperUploads(): Promise<PaperUpload[]> {
  const { data, error } = await supabase
    .from('paper_uploads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new PaperUploadError('Could not load your papers.', 'fetch_error');
  return (data ?? []) as PaperUpload[];
}

/** Fetch a single upload by ID (owner-scoped via RLS). */
export async function fetchPaperUpload(uploadId: string): Promise<PaperUpload | null> {
  const { data, error } = await supabase
    .from('paper_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle();

  if (error) throw new PaperUploadError('Could not load the paper.', 'fetch_error');
  return (data as PaperUpload) ?? null;
}

/** Fetch all questions for an upload (owner-scoped via RLS). */
export async function fetchPaperQuestions(uploadId: string): Promise<PaperQuestion[]> {
  const { data, error } = await supabase
    .from('paper_questions')
    .select('*')
    .eq('upload_id', uploadId)
    .order('position', { ascending: true });

  if (error) throw new PaperUploadError('Could not load extracted questions.', 'fetch_error');
  return (data ?? []) as PaperQuestion[];
}

/** Update a question's review status, edited text, or answer key. */
export async function updatePaperQuestion(
  questionId: string,
  updates: {
    review_status?: ReviewStatus;
    edited_text?: string | null;
    edited_options?: string[] | null;
    answer_key?: string | null;
    answer_key_source?: AnswerKeySource;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.review_status !== undefined) payload.review_status = updates.review_status;
  if (updates.edited_text !== undefined) payload.edited_text = updates.edited_text;
  if (updates.edited_options !== undefined) payload.edited_options = updates.edited_options;
  if (updates.answer_key !== undefined) payload.answer_key = updates.answer_key;
  if (updates.answer_key_source !== undefined) payload.answer_key_source = updates.answer_key_source;

  const { error } = await supabase
    .from('paper_questions')
    .update(payload)
    .eq('id', questionId);

  if (error) throw new PaperUploadError('Could not save the change.', 'update_error');
}

/** Delete an upload and its storage file (owner-scoped via RLS + storage policies). */
export async function deletePaperUpload(uploadId: string, storagePath: string): Promise<void> {
  // Delete storage file first
  await supabase.storage.from('paper-uploads').remove([storagePath]);

  const { error } = await supabase
    .from('paper_uploads')
    .delete()
    .eq('id', uploadId);

  if (error) throw new PaperUploadError('Could not delete the paper.', 'delete_error');
}

/** Get the effective question text (edited if available, else original). */
export function effectiveText(q: PaperQuestion): string {
  return q.edited_text ?? q.question_text;
}

/** Get the effective options (edited if available, else original). */
export function effectiveOptions(q: PaperQuestion): string[] | null {
  return q.edited_options ?? q.options;
}
