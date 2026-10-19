import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 30000;
const MIN_TEXT_CHARS = 20;
const GROQ_MODEL = 'openai/gpt-oss-20b';
const GROQ_TIMEOUT_MS = 30000;
const GROQ_MAX_TOKENS = 8000;

interface ExtractedQuestion {
  position: number;
  section_label: string | null;
  question_text: string;
  question_type: 'mcq' | 'short_answer' | 'long_answer' | 'fill_blank' | 'true_false' | 'unknown';
  options: string[] | null;
  marks: number | null;
  instruction_text: string | null;
  extraction_confidence: 'high' | 'medium' | 'low';
  has_figure: boolean;
  figure_note: string | null;
}

interface DetectionResult {
  isQuestionPaper: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  questions: ExtractedQuestion[];
  pageCount: number;
  isScanned: boolean;
}

const DETECTION_SYSTEM_PROMPT = [
  'You are an educational assessment analyzer. You receive extracted text from a PDF document.',
  'Your job: (1) determine whether the document genuinely contains exam questions, practice questions,',
  'PYQs (previous year questions), sample paper questions, mock test questions, or assessable worksheet',
  'questions — and (2) extract those questions faithfully.',
  '',
  'DETECTION RULES:',
  '- A document IS a question paper if it contains numbered or lettered questions intended for assessment.',
  '- Recognize: exam papers, PYQs, sample papers, mock tests, question worksheets, question banks.',
  '- A document is NOT a question paper if it is: lecture notes, a textbook chapter, a resume, a receipt,',
  'a novel/story, a research paper, a certificate, or any document without genuine assessable questions.',
  '- Do NOT classify a document as valid merely because it contains a question mark.',
  '- Notes with occasional rhetorical questions are NOT question papers.',
  '',
  'EXTRACTION RULES:',
  '- Extract ONLY questions that genuinely exist in the text. Never invent questions.',
  '- Preserve original question wording, numbering, and section boundaries.',
  '- For multiple-choice questions, include the answer options exactly as written.',
  '- If a question references a diagram/figure that cannot be extracted from text, set has_figure=true',
  '  and explain in figure_note.',
  '- If you cannot confidently read a question, set extraction_confidence to "low".',
  '- Do NOT invent answer keys. Answer keys are supplied later by the student.',
  '- If the text appears to be garbage/empty/unreadable (scanned PDF without OCR), set isScanned=true',
  '  and return isQuestionPaper=false.',
  '',
  'Respond ONLY with minified JSON matching this schema:',
  '{"isQuestionPaper":boolean,"confidence":"high|medium|low","reason":"<short explanation>",',
  '"isScanned":boolean,"questions":[{"position":number,"section_label":string|null,',
  '"question_text":string,"question_type":"mcq|short_answer|long_answer|fill_blank|true_false|unknown",',
  '"options":string[]|null,"marks":number|null,"instruction_text":string|null,',
  '"extraction_confidence":"high|medium|low","has_figure":boolean,"figure_note":string|null}]}',
].join('\n');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Extract text from a PDF using pdf-parse. Returns { text, pageCount }. */
async function extractPdfText(pdfBytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // Write to /tmp (edge function sandbox allows /tmp writes)
  const tempPath = `/tmp/pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
  await Deno.writeFile(tempPath, pdfBytes);

  try {
    // Dynamic import of pdf-parse
    const pdfParse = (await import('npm:pdf-parse@1.1.1')).default;
    const data = await pdfParse(tempPath);
    const text = (data.text || '').trim();
    const pageCount = data.numpages || 1;
    return { text, pageCount };
  } finally {
    try { await Deno.remove(tempPath); } catch { /* best effort */ }
  }
}

/** Call Groq to detect + extract questions from PDF text. */
async function detectAndExtract(
  groqKey: string,
  pdfText: string,
  pageCount: number
): Promise<DetectionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const truncatedText = pdfText.slice(0, MAX_TEXT_CHARS);
    const userPrompt = [
      `DOCUMENT TEXT (from a ${pageCount}-page PDF):`,
      '---BEGIN---',
      truncatedText,
      '---END---',
      '',
      'Analyze this document and extract questions per the rules.',
    ].join('\n');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: GROQ_MAX_TOKENS,
        messages: [
          { role: 'system', content: DETECTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      console.error('Groq error', res.status, bodyText.slice(0, 200));
      throw new Error(`AI provider error (${res.status})`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI returned empty response.');
    }

    // Parse the JSON from the response (it may be wrapped in markdown fences)
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) throw new Error('AI returned non-JSON response.');
    const parsed = JSON.parse(jsonMatch[0]) as DetectionResult;

    if (typeof parsed.isQuestionPaper !== 'boolean') {
      throw new Error('AI returned malformed detection result.');
    }

    return parsed;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AI analysis timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Sign in to process your paper.' });
    }
    const token = authHeader.slice(7);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return jsonResponse(401, { error: 'Your session has expired. Please sign in again.' });
    }
    const userId = userData.user.id;

    // ---- Input ----
    const body = await req.json() as { uploadId?: string };
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!UUID_RE.test(uploadId)) {
      return jsonResponse(400, { error: 'Invalid upload identifier.' });
    }

    // ---- Load upload record (owner-scoped) ----
    const { data: upload, error: uploadErr } = await admin
      .from('paper_uploads')
      .select('id, owner_id, storage_path, original_filename, status')
      .eq('id', uploadId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (uploadErr || !upload) {
      return jsonResponse(404, { error: 'Upload not found.' });
    }
    if (upload.status === 'processing') {
      return jsonResponse(409, { error: 'This paper is already being processed.' });
    }
    if (upload.status === 'extracted') {
      return jsonResponse(409, { error: 'This paper has already been processed.' });
    }

    // ---- Mark as processing ----
    await admin.from('paper_uploads').update({ status: 'processing' }).eq('id', uploadId);

    // ---- Download PDF from storage ----
    const { data: fileData, error: downloadErr } = await admin
      .storage
      .from('paper-uploads')
      .download(upload.storage_path);

    if (downloadErr || !fileData) {
      await admin.from('paper_uploads').update({
        status: 'failed',
        error_message: 'Could not download the uploaded file.',
      }).eq('id', uploadId);
      return jsonResponse(500, { error: 'Could not read the uploaded file.' });
    }

    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());

    // ---- Extract text from PDF ----
    let pdfText: string;
    let pageCount: number;
    try {
      const result = await extractPdfText(pdfBytes);
      pdfText = result.text;
      pageCount = result.pageCount;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF parsing failed.';
      await admin.from('paper_uploads').update({
        status: 'failed',
        error_message: msg,
      }).eq('id', uploadId);
      return jsonResponse(422, { error: 'Could not read this PDF. It may be corrupted or scanned without text.' });
    }

    // ---- Check for empty text (likely scanned PDF) ----
    if (pdfText.length < MIN_TEXT_CHARS) {
      await admin.from('paper_uploads').update({
        status: 'rejected',
        page_count: pageCount,
        detection_result: { isQuestionPaper: false, confidence: 'high', isScanned: true },
        detection_message: 'This PDF appears to be a scanned image without text. Text-based PDFs are required for question extraction. Please upload a text-based PDF, or type the questions manually.',
      }).eq('id', uploadId);
      return jsonResponse(200, {
        status: 'rejected',
        reason: 'scanned_pdf',
        message: 'This PDF appears to be scanned without embedded text. Please upload a text-based PDF.',
      });
    }

    // ---- Groq detection + extraction ----
    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) {
      await admin.from('paper_uploads').update({
        status: 'failed',
        error_message: 'AI service is not configured.',
      }).eq('id', uploadId);
      return jsonResponse(503, { error: 'Question analysis is temporarily unavailable. Please try again later.' });
    }

    let detection: DetectionResult;
    try {
      detection = await detectAndExtract(groqKey, pdfText, pageCount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed.';
      await admin.from('paper_uploads').update({
        status: 'failed',
        error_message: msg,
      }).eq('id', uploadId);
      return jsonResponse(502, { error: msg });
    }

    // ---- Handle rejection ----
    if (!detection.isQuestionPaper || !detection.questions || detection.questions.length === 0) {
      const message = detection.isScanned
        ? 'This PDF appears to be scanned without embedded text. Please upload a text-based PDF.'
        : "This document doesn't appear to contain an exam or practice questions. Please upload a question paper, PYQ, sample paper, mock test or question worksheet.";

      await admin.from('paper_uploads').update({
        status: 'rejected',
        page_count: pageCount,
        detection_result: {
          isQuestionPaper: false,
          confidence: detection.confidence ?? 'medium',
          isScanned: Boolean(detection.isScanned),
          reason: detection.reason ?? 'no_questions_found',
        },
        detection_message: message,
        processed_at: new Date().toISOString(),
      }).eq('id', uploadId);

      return jsonResponse(200, {
        status: 'rejected',
        reason: detection.isScanned ? 'scanned_pdf' : 'not_question_paper',
        message,
      });
    }

    // ---- Persist extracted questions ----
    const questions = detection.questions.slice(0, 100); // safety cap
    const rows = questions.map((q) => ({
      upload_id: uploadId,
      owner_id: userId,
      position: q.position || 0,
      section_label: q.section_label ?? null,
      question_text: (q.question_text || '').slice(0, 4000),
      question_type: q.question_type || 'unknown',
      options: Array.isArray(q.options) ? JSON.stringify(q.options) : null,
      marks: typeof q.marks === 'number' ? q.marks : null,
      instruction_text: q.instruction_text ?? null,
      extraction_confidence: q.extraction_confidence || 'medium',
      has_figure: Boolean(q.has_figure),
      figure_note: q.figure_note ?? null,
      review_status: 'pending',
    }));

    const { error: insertErr } = await admin.from('paper_questions').insert(rows);
    if (insertErr) {
      console.error('question insert failed', insertErr.message);
      await admin.from('paper_uploads').update({
        status: 'failed',
        error_message: 'Could not save extracted questions.',
      }).eq('id', uploadId);
      return jsonResponse(500, { error: 'Could not save extracted questions. Please try again.' });
    }

    // ---- Mark as extracted ----
    await admin.from('paper_uploads').update({
      status: 'extracted',
      page_count: pageCount,
      detection_result: {
        isQuestionPaper: true,
        confidence: detection.confidence,
        reason: detection.reason,
        questionCount: questions.length,
      },
      detection_message: detection.confidence === 'low'
        ? 'Some questions may need review. Please verify the extracted questions before proceeding.'
        : null,
      processed_at: new Date().toISOString(),
    }).eq('id', uploadId);

    return jsonResponse(200, {
      status: 'extracted',
      questionCount: questions.length,
      confidence: detection.confidence,
    });
  } catch (err) {
    console.error('paper-extract unexpected error', err instanceof Error ? err.message : err);
    return jsonResponse(500, { error: 'An unexpected error occurred during processing.' });
  }
});
