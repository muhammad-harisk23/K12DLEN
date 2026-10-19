/**
 * Pure focus-session state rules for the learning workspace.
 *
 * A single source of truth for the playback→timer contract, kept free of
 * React/DOM so Node regression tests exercise the exact production logic.
 * Focus seconds are an engagement measure — never proof of attention, and
 * never a reward for watching videos.
 */

export interface SessionState {
  /** Deliberate session phase: ready | studying | paused. */
  phase: 'ready' | 'studying' | 'paused';
  /** True only while the player has confirmed PLAYING. */
  playing: boolean;
  /** Set on playback error; cleared by the next confirmed PLAYING. */
  playbackError: boolean;
  /** Latched when the tab hides; cleared only by a new confirmed PLAYING. */
  hidden: boolean;
}

export const INITIAL_SESSION_STATE: SessionState = {
  phase: 'ready',
  playing: false,
  playbackError: false,
  hidden: false,
};

/** Focus time accrues only when every gate is open. */
export function isCounting(s: SessionState): boolean {
  return s.phase === 'studying' && s.playing && !s.hidden && !s.playbackError;
}

/**
 * YouTube player state transition. Every non-PLAYING state (PAUSED,
 * BUFFERING, CUED, UNSTARTED, ENDED) clears the playing flag immediately,
 * so buffering gaps never count as focus time.
 */
export function applyPlayerState(s: SessionState, state: number): SessionState {
  const PLAYING = 1;
  if (state === PLAYING) {
    // A deliberate native play resumes the session from ready/paused.
    return { ...s, phase: 'studying', playing: true, playbackError: false, hidden: false };
  }
  return { ...s, playing: false };
}

/** Playback error stops accrual until the next confirmed PLAYING. */
export function applyPlayerError(s: SessionState): SessionState {
  return {
    ...s,
    playing: false,
    playbackError: true,
    phase: s.phase === 'studying' ? 'paused' : s.phase,
  };
}

/** Application pause: stops the video and the timer; resume is deliberate. */
export function applyPause(s: SessionState): SessionState {
  return { ...s, playing: false, phase: s.phase === 'studying' ? 'paused' : s.phase };
}

/** Tab hidden: latch, stop accrual, and keep it latched after returning. */
export function applyTabHidden(s: SessionState): SessionState {
  return {
    ...s,
    hidden: true,
    playing: false,
    phase: s.phase === 'studying' ? 'paused' : s.phase,
  };
}

/** Tab visible again never auto-resumes; the latch holds until a new PLAYING. */
export function applyTabVisible(s: SessionState): SessionState {
  return { ...s, hidden: false };
}

/**
 * Saved position applies to exactly one video: the video it was saved for.
 * A playlist target never inherits a position owned by another item, and a
 * saved row with no video id (single video, legacy) must not leak into a
 * playlist item either.
 */
export function resumePositionFor(
  savedPosition: number | null | undefined,
  savedVideoId: string | null | undefined,
  targetVideoId: string | null | undefined
): number {
  const pos = typeof savedPosition === 'number' && Number.isFinite(savedPosition)
    ? Math.floor(savedPosition)
    : 0;
  if (pos <= 0) return 0;
  if (targetVideoId) {
    return savedVideoId != null && savedVideoId === targetVideoId ? pos : 0;
  }
  return pos;
}
