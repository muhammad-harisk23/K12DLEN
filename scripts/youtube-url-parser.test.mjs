// URL parser regression tests for src/lib/youtube.ts (parseYouTubeUrl).
// Run: node scripts/youtube-url-parser.test.mjs
// Uses the installed TypeScript compiler to transpile the real parser, so
// the tests exercise the exact production code (no duplicated logic).

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));

const tsPath = join(here, '..', 'src', 'lib', 'youtube.ts');
const outDir = mkdtempSync(join(tmpdir(), 'yt-parser-test-'));
const outFile = join(outDir, 'youtube.js');

const { outputText } = ts.transpileModule(readFileSync(tsPath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
writeFileSync(outFile, outputText);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

const { parseYouTubeUrl } = require(outFile);

let passed = 0;
let failed = 0;

function assertOk(url, expectedType, expectedId, label) {
  const result = parseYouTubeUrl(url);
  if (result.ok && result.parsed.type === expectedType && result.parsed.id === expectedId) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL (accept): ${label}\n  input: ${url}\n  got: ${JSON.stringify(result)}`);
  }
}

function assertRejected(url, label) {
  const result = parseYouTubeUrl(url);
  if (!result.ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL (reject): ${label}\n  input: ${url}\n  got: ${JSON.stringify(result)}`);
  }
}

// ---------- ACCEPTED shapes ----------
assertOk('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video', 'dQw4w9WgXcQ', 'watch URL');
assertOk('https://youtu.be/dQw4w9WgXcQ', 'video', 'dQw4w9WgXcQ', 'short link');
assertOk('https://youtu.be/dQw4w9WgXcQ?si=abc123', 'video', 'dQw4w9WgXcQ', 'short link with si param');
assertOk('https://www.youtube.com/live/-UdHmSTmQtw?si=xYz', 'video', '-UdHmSTmQtw', 'live URL (regression from spec)');
assertOk('https://youtube.com/live/-UdHmSTmQtw', 'video', '-UdHmSTmQtw', 'live URL no subdomain');
assertOk('https://m.youtube.com/live/-UdHmSTmQtw', 'video', '-UdHmSTmQtw', 'live URL mobile');
assertOk('https://www.youtube.com/shorts/-UdHmSTmQtw', 'video', '-UdHmSTmQtw', 'shorts URL');
assertOk(
  'https://www.youtube.com/playlist?list=PL0vfts4VzfNiI1BsIK5u7LpPaIDKMJIDN',
  'playlist',
  'PL0vfts4VzfNiI1BsIK5u7LpPaIDKMJIDN',
  'playlist URL'
);
assertOk(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL0vfts4VzfNiI1BsIK5u7LpPaIDKMJIDN',
  'playlist',
  'PL0vfts4VzfNiI1BsIK5u7LpPaIDKMJIDN',
  'video-in-playlist'
);
assertOk(
  'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  'video',
  'dQw4w9WgXcQ',
  'music.youtube.com'
);

// ---------- REJECTED: malformed / malicious ----------
assertRejected('https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'lookalike host');
assertRejected('https://evil.test/youtube/watch?v=dQw4w9WgXcQ', 'path-only mimic');
assertRejected('http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'http not https');
assertRejected('https://youtube-com/watch?v=dQw4w9WgXcQ', 'hyphen host trick');
assertRejected('https://www.youtube.com/watch', 'watch with no id');
assertRejected('https://www.youtube.com/watch?v=short', 'video id too short');
assertRejected('https://www.youtube.com/watch?v=toolongvideoid0000', 'video id too long');
assertRejected('https://www.youtube.com/playlist', 'playlist with no list id');
assertRejected('https://www.youtube.com/playlist?list=short', 'playlist id too short');
assertRejected('https://www.youtube.com/live/not-a-valid-id!!', 'live with bad id');
assertRejected('https://www.youtube.com/live/', 'live with empty id');
assertRejected('https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed path (iframe-only shape)');
assertRejected('javascript:alert(1)', 'javascript scheme');
assertRejected('data:text/html,<script>alert(1)</script>', 'data scheme');
assertRejected('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ', 'basic-auth trick');
assertRejected('   ', 'empty/whitespace input');
assertRejected('not a url at all', 'plain text');

// ---------- Results ----------
console.log(`\nyoutube-url-parser: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
