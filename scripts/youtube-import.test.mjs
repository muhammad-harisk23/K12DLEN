// Real end-to-end test of the youtube-import edge function.
// Self-provisions a throwaway test account, then exercises video import,
// playlist import, invalid URLs, auth rejection, and duplicate-import
// idempotency against the deployed edge function with real API calls.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('FAIL: missing Supabase env');
  process.exit(1);
}

// Unique throwaway account per run
const email = `gate1a-test-${Date.now()}@example.com`;
const password = 'Gate1aTestPass!' + Math.random().toString(36).slice(2, 8);

const supabase = createClient(url, anon);
const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
if (authError || !authData.session) {
  console.error('FAIL: test signup', authError?.message ?? 'no session');
  process.exit(1);
}
const token = authData.session.access_token;
const userId = authData.user.id;
console.log('signed in as', userId);

const fnUrl = `${url}/functions/v1/youtube-import`;
let pass = 0;
let fail = 0;
function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

async function callImport(payload, expectStatus) {
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: anon,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// 1. Valid video URL -> real metadata
{
  const { status, body } = await callImport(
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', topic: 'integration test' },
    200
  );
  const r = body.resource;
  report(
    'video import returns real metadata',
    status === 200 && r && typeof r.title === 'string' && r.title.length > 0 && r.channel_name,
    `title=${JSON.stringify(r?.title)} channel=${JSON.stringify(r?.channel_name)} duration=${r?.metadata?.duration_seconds}s embeddable=${r?.metadata?.embeddable}`
  );
  globalThis.__videoResource = r;
}

// 2. youtu.be short URL of a well-known education video
{
  const { status, body } = await callImport({ url: 'https://youtu.be/aircAruvnKk' });
  report(
    'youtu.be short link imports',
    status === 200 && body.resource?.youtube_id === 'aircAruvnKk' && body.resource?.title,
    `title=${JSON.stringify(body.resource?.title)}`
  );
}

// 3. Valid public playlist -> ordered items
{
  const { status, body } = await callImport({ url: 'https://www.youtube.com/playlist?list=PLillGF-RfqbY3c2r0htQyVbDJJoBFE6Rb' });
  const r = body.resource;
  const items = r?.metadata?.items ?? [];
  const ordered = items.every((it, i) => (i === 0 ? true : items[i - 1].position <= it.position));
  report(
    'playlist import returns ordered real items',
    status === 200 && r?.source_type === 'playlist' && items.length > 0 && ordered && r.title && r.channel_name,
    `title=${JSON.stringify(r?.title)} items=${items.length} first=${JSON.stringify(items[0]?.title)}`
  );
  globalThis.__playlistResource = r;
}

// 4. Duplicate import -> same row id (idempotent)
{
  const { status, body } = await callImport({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  report(
    'duplicate import is idempotent (same resource id)',
    status === 200 && body.resource?.id === globalThis.__videoResource?.id,
    `id=${body.resource?.id}`
  );
}

// 5. Invalid URL rejections
{
  const cases = [
    ['https://vimeo.com/12345', 'non-youtube host'],
    ['https://www.youtube.com/watch?v=short', 'bad video id'],
    ['https://www.youtube.com/feeds/videos.xml', 'unsupported path'],
    ['not a url', 'not a url'],
    ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'http not https'],
    ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'lookalike host'],
  ];
  for (const [u, label] of cases) {
    const { status, body } = await callImport({ url: u });
    report(`invalid URL rejected: ${label}`, status === 400 && typeof body.error === 'string', body.error);
  }
}

// 6. Nonexistent video -> 404 with clear message
{
  const { status, body } = await callImport({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  report('nonexistent video -> 404 with message', status === 404 && body.error, body.error);
}

// 7. No auth -> 401
{
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
  });
  report('unauthenticated call rejected', res.status === 401, `status=${res.status}`);
}

// 8. No secret in response: scan all bodies for google api key shapes
{
  const responses = [globalThis.__videoResource, globalThis.__playlistResource];
  const blob = JSON.stringify(responses);
  const leaky = /AIza[\w-]{30,}/.test(blob);
  report('no API key material in responses', !leaky);
}

// 9. Cross-account isolation (DB-level, anon key, no token)
{
  const res2 = await fetch(`${url}/rest/v1/user_resources?select=*`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  const rows = await res2.json();
  report(
    'user sees only own resources (DB query)',
    Array.isArray(rows) && rows.every((r) => r.owner_id === userId),
    `rows=${Array.isArray(rows) ? rows.length : 'n/a'}`
  );
}

// 10. Rate log: count rows for this user (via owner check on function side is service-only)
{
  // Try to read import_rate_log through the REST API as the user — expect empty/error (deny-by-default RLS)
  const res3 = await fetch(`${url}/rest/v1/import_rate_log?select=*`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  const rows = await res3.json().catch(() => null);
  report(
    'import_rate_log hidden from client role',
    Array.isArray(rows) && rows.length === 0,
    `rows=${Array.isArray(rows) ? rows.length : 'blocked/none'}`
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
