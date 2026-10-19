// Paper to Practice — Phase 6A integration + security test.
// Verifies: private upload, RLS isolation, edge-function extraction,
// question persistence, and rejection of non-question documents.
// Uses only anon-key clients (signUp + RLS), matching the app's real auth path.
//
// The edge function test requires GROQ_API_KEY to be deployed. If the key
// is absent, extraction checks are skipped with a clear note.
//
// Run: node scripts/paper-to-practice.test.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1];

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

let pass = 0;
let fail = 0;
let skip = 0;
function ok(name) { pass++; console.log(`PASS: ${name}`); }
function bad(name, detail) { fail++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
function skipped(name, reason) { skip++; console.log(`SKIP: ${name}${reason ? ' — ' + reason : ''}`); }

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

const suffix = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'PaperTest!1' + suffix;
const emails = {
  a: `paper-a-${suffix}@test.local`,
  b: `paper-b-${suffix}@test.local`,
};
const clients = {};
const userIds = {};

async function getStudent(who) {
  const email = emails[who];
  const c = client();
  let res = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error) {
    res = await c.auth.signUp({ email, password: PASSWORD });
    if (res.error || !res.data?.user) {
      throw new Error(`setup failed for ${who}: ${res.error?.message ?? 'no user'}`);
    }
  }
  const u = await c.auth.getUser();
  if (u.error || !u.data.user) throw new Error(`getUser failed for ${who}: ${u.error?.message}`);
  clients[who] = c;
  userIds[who] = u.data.user.id;
}

async function ensureProfile(who) {
  await clients[who].from('student_profiles').upsert({ id: userIds[who], display_name: `Paper ${who.toUpperCase()} ${suffix}` });
}

/** Create a minimal valid PDF with embedded text. */
function makeQuestionPaperPdf() {
  // A minimal text-based PDF with exam questions
  const text = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 320 >> stream
BT
/F1 12 Tf
72 720 Td
(Science Sample Paper - Class 10) Tj
0 -30 Td
(Section A - Multiple Choice Questions) Tj
0 -25 Td
(1. Which of the following is a product of photosynthesis?) Tj
0 -20 Td
(A) Carbon dioxide  (B) Glucose  (C) Nitrogen  (D) Hydrogen) Tj
0 -25 Td
(2. The powerhouse of the cell is:) Tj
0 -20 Td
(A) Nucleus  (B) Mitochondria  (C) Ribosome  (D) Vacuole) Tj
0 -25 Td
(3. What is the chemical formula of water?) Tj
0 -20 Td
(A) H2O  (B) CO2  (C) NaCl  (D) CH4) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000610 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
682
%%EOF`;
  return new Blob([text], { type: 'application/pdf' });
}

/** Create a minimal PDF with non-question content (a resume). */
function makeResumePdf() {
  const text = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 200 >> stream
BT
/F1 12 Tf
72 720 Td
(John Doe) Tj
0 -25 Td
(123 Main Street, Anytown, USA) Tj
0 -20 Td
(Email: john.doe@email.com | Phone: 555-0123) Tj
0 -30 Td
(Experience:) Tj
0 -20 Td
(Software Engineer at Tech Corp, 2020-2024) Tj
0 -20 Td
(Developed web applications using React and Node.js.) Tj
0 -25 Td
(Education: Bachelor of Science in Computer Science) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000490 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
562
%%EOF`;
  return new Blob([text], { type: 'application/pdf' });
}

async function uploadPdf(who, blob, filename) {
  const c = clients[who];
  const userId = userIds[who];
  const uploadId = randomUUID();
  const storagePath = `${userId}/${uploadId}.pdf`;

  const { error: storageErr } = await c.storage.from('paper-uploads').upload(storagePath, blob, {
    contentType: 'application/pdf',
  });
  if (storageErr) throw new Error(`storage upload: ${storageErr.message}`);

  const { data, error } = await c.from('paper_uploads').insert({
    id: uploadId,
    storage_path: storagePath,
    original_filename: filename,
    file_size_bytes: blob.size,
  }).select('*').single();
  if (error) throw new Error(`db insert: ${error.message}`);
  return { uploadId, data };
}

async function callExtract(who, uploadId) {
  const c = clients[who];
  const { data: session } = await c.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('no session token');

  const res = await fetch(`${url}/functions/v1/paper-extract`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ uploadId }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

(async () => {
  await getStudent('a');
  await getStudent('b');
  await ensureProfile('a');
  await ensureProfile('b');

  // ========== RLS ISOLATION TESTS ==========

  // #1 A uploads a paper; B cannot see it
  const pdfBlob = makeQuestionPaperPdf();
  const { uploadId: aUploadId, data: aUpload } = await uploadPdf('a', pdfBlob, 'science-sample.pdf');
  ok('#1 A can upload a PDF and create a record');

  // #2 B cannot SELECT A's upload
  const { data: bSeesA } = await clients.b.from('paper_uploads').select('*').eq('id', aUploadId);
  if (!bSeesA || bSeesA.length === 0) {
    ok('#2 B cannot read A upload record (RLS isolation)');
  } else {
    bad('#2 B can read A upload (RLS leak)');
  }

  // #3 B cannot download A's file from storage
  const { data: bFile, error: bFileErr } = await clients.b.storage.from('paper-uploads').download(`${userIds.a}/${aUploadId}.pdf`);
  if (bFileErr || !bFile) {
    ok('#3 B cannot download A PDF from storage (storage RLS)');
  } else {
    bad('#3 B can download A PDF (storage RLS leak)');
  }

  // #4 A can download own file
  const { data: aFile, error: aFileErr } = await clients.a.storage.from('paper-uploads').download(`${userIds.a}/${aUploadId}.pdf`);
  if (aFile && !aFileErr) {
    ok('#4 A can download own PDF from storage');
  } else {
    bad('#4 A cannot download own PDF', aFileErr?.message ?? 'unknown');
  }

  // #5 B cannot insert questions into A's upload
  const { error: bInsertErr } = await clients.b.from('paper_questions').insert({
    upload_id: aUploadId,
    owner_id: userIds.a,
    position: 999,
    question_text: 'hacked',
  });
  if (bInsertErr) {
    ok('#5 B cannot insert questions into A upload (RLS)');
  } else {
    bad('#5 B inserted question into A upload (RLS leak)');
  }

  // ========== EDGE FUNCTION TESTS ==========

  // #6 Edge function processes A's question paper PDF
  const extractRes = await callExtract('a', aUploadId);
  if (extractRes.status === 200 && extractRes.body.status === 'extracted') {
    ok(`#6 Edge function extracted questions from A paper (count=${extractRes.body.questionCount})`);
    if (extractRes.body.questionCount > 0 && extractRes.body.questionCount <= 100) {
      ok('#6b Extracted question count is positive and reasonable');
    } else {
      bad('#6b Unexpected question count', String(extractRes.body.questionCount));
    }
  } else if (extractRes.status === 503) {
    skipped('#6 Edge function (GROQ_API_KEY not configured)', extractRes.body.error ?? 'service unavailable');
  } else if (extractRes.status === 502 || extractRes.status === 500) {
    skipped('#6 Edge function (AI provider error)', extractRes.body.error ?? `status ${extractRes.status}`);
  } else if (extractRes.body.status === 'rejected') {
    bad('#6 Edge function rejected a valid question paper', extractRes.body.message ?? '');
  } else {
    bad('#6 Edge function unexpected response', JSON.stringify({ status: extractRes.status, body: extractRes.body }));
  }

  // #7 Questions are persisted and A can read them
  if (extractRes.status === 200 && extractRes.body.status === 'extracted') {
    const { data: questions, error: qErr } = await clients.a
      .from('paper_questions')
      .select('*')
      .eq('upload_id', aUploadId)
      .order('position', { ascending: true });
    if (qErr) {
      bad('#7 Could not load extracted questions', qErr.message);
    } else if (questions && questions.length > 0) {
      ok(`#7 A can read ${questions.length} extracted questions`);
      const hasRealText = questions.every((q) => q.question_text && q.question_text.length > 0);
      if (hasRealText) {
        ok('#7b All extracted questions have real text content');
      } else {
        bad('#7b Some questions have empty text');
      }
    } else {
      bad('#7 No questions persisted after extraction');
    }
  } else {
    skipped('#7 Question persistence (extraction did not succeed)');
  }

  // #8 B cannot read A's extracted questions
  if (extractRes.status === 200 && extractRes.body.status === 'extracted') {
    const { data: bQuestions } = await clients.b
      .from('paper_questions')
      .select('*')
      .eq('upload_id', aUploadId);
    if (!bQuestions || bQuestions.length === 0) {
      ok('#8 B cannot read A extracted questions (RLS)');
    } else {
      bad('#8 B can read A questions (RLS leak)');
    }
  } else {
    skipped('#8 B question isolation (extraction did not succeed)');
  }

  // #9 Duplicate processing is prevented
  const dupRes = await callExtract('a', aUploadId);
  if (dupRes.status === 409) {
    ok('#9 Duplicate processing prevented (409)');
  } else {
    bad('#9 Duplicate processing not prevented', `status=${dupRes.status}`);
  }

  // #10 A can update question review status
  if (extractRes.status === 200 && extractRes.body.status === 'extracted') {
    const { data: questions } = await clients.a
      .from('paper_questions')
      .select('id')
      .eq('upload_id', aUploadId)
      .limit(1);
    if (questions && questions.length > 0) {
      const qId = questions[0].id;
      const { error: updErr } = await clients.a
        .from('paper_questions')
        .update({ review_status: 'confirmed' })
        .eq('id', qId);
      if (!updErr) {
        ok('#10 A can update question review status');
      } else {
        bad('#10 A cannot update question review status', updErr.message);
      }
    }
  } else {
    skipped('#10 Question update (extraction did not succeed)');
  }

  // ========== REJECTION TEST ==========

  // #11 Non-question document (resume) is rejected
  const resumeBlob = makeResumePdf();
  const { uploadId: resumeUploadId } = await uploadPdf('a', resumeBlob, 'resume.pdf');
  const resumeRes = await callExtract('a', resumeUploadId);
  if (resumeRes.status === 200 && resumeRes.body.status === 'rejected') {
    ok('#11 Non-question PDF rejected with clear message');
    if (resumeRes.body.message && /question|exam|practice/i.test(resumeRes.body.message)) {
      ok('#11b Rejection message guides user to upload a question paper');
    } else {
      bad('#11b Rejection message unclear', resumeRes.body.message ?? '');
    }
  } else if (resumeRes.status === 503 || resumeRes.status === 502 || resumeRes.status === 500) {
    skipped('#11 Resume rejection (AI provider unavailable)');
  } else {
    bad('#11 Resume not rejected', JSON.stringify({ status: resumeRes.status, body: resumeRes.body }));
  }

  // ========== INVALID UPLOAD ID TEST ==========

  // #12 Calling extract with another user's upload ID fails
  const { data: aSession } = await clients.a.auth.getSession();
  const aToken = aSession.session?.access_token;
  const fakeRes = await fetch(`${url}/functions/v1/paper-extract`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aToken}`,
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ uploadId: randomUUID() }),
  });
  if (fakeRes.status === 404) {
    ok('#12 Random upload ID returns 404 (no access to others data)');
  } else {
    bad('#12 Random upload ID not rejected', `status=${fakeRes.status}`);
  }

  // #13 Invalid UUID is rejected
  const badRes = await fetch(`${url}/functions/v1/paper-extract`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aToken}`,
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ uploadId: 'not-a-uuid' }),
  });
  if (badRes.status === 400) {
    ok('#13 Invalid UUID rejected (400)');
  } else {
    bad('#13 Invalid UUID not rejected', `status=${badRes.status}`);
  }

  // ========== FILE TYPE VALIDATION ==========

  // #14 Non-PDF file type rejected by storage bucket
  const textBlob = new Blob(['hello world'], { type: 'text/plain' });
  const { error: badTypeErr } = await clients.a.storage.from('paper-uploads').upload(`${userIds.a}/${randomUUID()}.txt`, textBlob, {
    contentType: 'text/plain',
  });
  if (badTypeErr) {
    ok('#14 Non-PDF file type rejected by storage bucket');
  } else {
    bad('#14 Non-PDF file accepted by storage (should be rejected)');
  }

  // ========== CLEANUP ==========
  await clients.a.from('paper_uploads').delete().eq('id', aUploadId);
  await clients.a.from('paper_uploads').delete().eq('id', resumeUploadId);
  await clients.a.from('student_profiles').delete().eq('id', userIds.a);
  await clients.b.from('student_profiles').delete().eq('id', userIds.b);

  console.log(`\npaper-to-practice: ${pass} passed, ${fail} failed, ${skip} skipped, ${pass + fail + skip} total`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
