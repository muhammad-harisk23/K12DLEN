// Focus-session state rules regression tests for src/lib/sessionRules.ts.
// Run: node scripts/session-rules.test.mjs
// Transpiles the real production module, so tests exercise the exact logic
// shipped to the browser (no duplicated logic). These are mocked-event tests
// over the pure state machine — genuine in-browser YouTube playback
// verification is listed separately in the completion report.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));

const tsPath = join(here, '..', 'src', 'lib', 'sessionRules.ts');
const outDir = mkdtempSync(join(tmpdir(), 'session-rules-test-'));
const outFile = join(outDir, 'sessionRules.js');

const { outputText } = ts.transpileModule(readFileSync(tsPath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
writeFileSync(outFile, outputText);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

const {
  INITIAL_SESSION_STATE,
  applyPlayerState,
  applyPlayerError,
  applyPause,
  applyTabHidden,
  applyTabVisible,
  isCounting,
  resumePositionFor,
} = require(outFile);

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// YouTube PlayerState constants (mirror of src/lib/youtubeIframeApi.ts).
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;
const UNSTARTED = -1;
const ENDED = 0;

// 1. PLAYING starts eligible focus-time accounting.
{
  let s = INITIAL_SESSION_STATE;
  s = applyPlayerState(s, PLAYING);
  assert('1. PLAYING from ready starts counting', isCounting(s), true);
  assert('1. PLAYING moves phase to studying', s.phase, 'studying');
}

// 2. PAUSED stops accounting.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerState(s, PAUSED);
  assert('2. PAUSED stops counting', isCounting(s), false);
  assert('2. PAUSED clears playing flag', s.playing, false);
}

// 3. BUFFERING stops accounting (incl. direct PLAYING -> BUFFERING).
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerState(s, BUFFERING);
  assert('3. BUFFERING stops counting', isCounting(s), false);
  s = applyPlayerState(s, PLAYING);
  assert('3. BUFFERING -> PLAYING resumes counting', isCounting(s), true);
  s = applyPlayerState(s, BUFFERING);
  s = applyPlayerState(s, PLAYING);
  assert('3. flapping BUFFERING/PLAYING counts only while playing', isCounting(s), true);
}

// 3b. CUED and UNSTARTED stop accounting.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerState(s, CUED);
  assert('3b. CUED stops counting', isCounting(s), false);
  s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerState(s, UNSTARTED);
  assert('3b. UNSTARTED stops counting', isCounting(s), false);
}

// 4. ENDED and ERROR stop accounting.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerState(s, ENDED);
  assert('4. ENDED stops counting', isCounting(s), false);
  s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPlayerError(s);
  assert('4. ERROR stops counting', isCounting(s), false);
  assert('4. ERROR pauses the session', s.phase, 'paused');
  // Recovery only via a fresh confirmed PLAYING.
  s = applyPlayerState(s, PLAYING);
  assert('4. fresh PLAYING clears the error latch', isCounting(s), true);
}

// 4b. PLAYING -> BUFFERING -> PLAYING -> PAUSED full sequence.
{
  let s = INITIAL_SESSION_STATE;
  s = applyPlayerState(s, PLAYING);
  assert('4b-1', isCounting(s), true);
  s = applyPlayerState(s, BUFFERING);
  assert('4b-2', isCounting(s), false);
  s = applyPlayerState(s, PLAYING);
  assert('4b-3', isCounting(s), true);
  s = applyPlayerState(s, PAUSED);
  assert('4b-4', isCounting(s), false);
}

// 5. Hidden tab stops accounting and latches until a new PLAYING.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyTabHidden(s);
  assert('5. hidden stops counting', isCounting(s), false);
  assert('5. hidden pauses the session', s.phase, 'paused');
  assert('5. hidden clears the playing flag', s.playing, false);
}

// 6. Returning to the visible tab does NOT automatically resume.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyTabHidden(s);
  s = applyTabVisible(s);
  assert('6. visible again does not resume counting', isCounting(s), false);
  assert('6. visible again keeps the session paused', s.phase, 'paused');
  assert('6. visible again keeps playing false', s.playing, false);
}

// 7. Manual resume counts only after PLAYING confirmation.
{
  let s = applyTabHidden(applyPlayerState(INITIAL_SESSION_STATE, PLAYING));
  s = applyTabVisible(s);
  // Even after an app-level resume click, counting waits for PLAYING.
  s = { ...s, phase: 'studying' };
  assert('7. resume click without PLAYING does not count', isCounting(s), false);
  s = applyPlayerState(s, PLAYING);
  assert('7. resume counts only after PLAYING', isCounting(s), true);
}

// 7b. Application pause stops the timer; PLAYING confirmation resumes it.
{
  let s = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  s = applyPause(s);
  assert('7b. app pause stops counting', isCounting(s), false);
  assert('7b. app pause sets phase paused', s.phase, 'paused');
  s = applyPlayerState(s, PLAYING);
  assert('7b. resume after app pause counts', isCounting(s), true);
}

// 8. Saved position is restored for the correct video only.
{
  assert('8. matching video restores position',
    resumePositionFor(120, 'abc123', 'abc123'), 120);
  assert('8. different playlist video does not inherit position',
    resumePositionFor(120, 'abc123', 'xyz789'), 0);
  assert('8. null saved video never matches a playlist target',
    resumePositionFor(120, null, 'abc123'), 0);
  assert('8. legacy row with no ids restores for the single video',
    resumePositionFor(120, null, null), 120);
  assert('8. zero/absent position never restores',
    resumePositionFor(0, 'abc123', 'abc123'), 0);
  assert('8. non-finite position is rejected',
    resumePositionFor(NaN, 'abc123', 'abc123'), 0);
  assert('8. fractional positions are floored',
    resumePositionFor(120.9, 'abc123', 'abc123'), 120);
}

// 9. (Behavioral contract) Pause/tab-hide capture fresh position rather
// than stale. The page-level capture is exercised here by asserting the
// rule the page relies on: capture writes are keyed by the passed video id,
// so a capture under a new id can never be read back for the old one.
{
  // Simulated: capture(vidB) after capture(vidA) — vidA's value must not
  // be resurrected for vidB on resume.
  const savedForA = 30;
  const capturedForB = 95;
  assert('9. switching capture target changes the saved pair',
    [resumePositionFor(savedForA, 'vidA', 'vidB'),
     resumePositionFor(capturedForB, 'vidB', 'vidB')],
    [0, capturedForB]);
}

// 10. Playlist switch does not transfer the previous video's timestamp.
{
  // Saved position belongs to the first item; switching to item two must
  // restore zero, not the first item's timestamp.
  assert('10. no timestamp transfer across items',
    resumePositionFor(240, 'item-one', 'item-two'), 0);
  // Returning to the original item still restores its own position.
  assert('10. original item keeps its own position',
    resumePositionFor(240, 'item-one', 'item-one'), 240);
}

// 11. (Behavioral contract) Re-renders do not duplicate timers or players.
// The page guards this structurally: every interval is created inside a
// useEffect keyed on the memo-derived counting flag and cleared on cleanup,
// and the player instance is created once per mount in YouTubePlayer's
// mount-only effect. Assert the state-machine inputs are pure/idempotent so
// replaying them after re-render cannot change the outcome.
{
  const s0 = applyPlayerState(INITIAL_SESSION_STATE, PLAYING);
  const s1 = applyPlayerState(s0, PLAYING); // duplicate PLAYING (re-render)
  assert('11. duplicate PLAYING is idempotent', [s1.phase, s1.playing], ['studying', true]);
  assert('11. duplicate PLAYING stays counting', isCounting(s1), true);
}

console.log(`\nsession-rules: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
