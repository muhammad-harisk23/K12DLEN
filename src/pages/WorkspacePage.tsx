import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  ListVideo,
  Pause,
  Play,
  Target,
  Users,
} from 'lucide-react';
import { YouTubePlayer } from '@/components/workspace/YouTubePlayer';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { formatDuration, watchUrl } from '@/lib/youtube';
import { PlayerState } from '@/lib/youtubeIframeApi';
import type { YTPlayer } from '@/lib/youtubeIframeApi';
import {
  INITIAL_SESSION_STATE,
  applyPause,
  applyPlayerError,
  applyPlayerState,
  applyTabHidden,
  applyTabVisible,
  isCounting,
  resumePositionFor,
} from '@/lib/sessionRules';
import type { SessionState } from '@/lib/sessionRules';
import type { PlaylistItemMeta } from '@/pages/WorkspaceLoader';
import type { StudentProfile } from '@/types/curriculum';

interface WorkspaceProps {
  profile: StudentProfile;
  resourceId: string;
  title: string | null;
  channel: string | null;
  topic: string | null;
  /** 'video' or 'playlist' — from the stored resource row. */
  parsedType: 'video' | 'playlist';
  /** YouTube id of the resource (video id, or playlist id). */
  youtubeId: string;
  /** Single-video embeddability from YouTube (null = unknown). */
  embeddable: boolean | null;
  playlistItems: PlaylistItemMeta[] | null;
  playlistTruncated: boolean;
  initialFocusSeconds: number;
  initialPositionSeconds: number;
  /** YouTube video id the saved position belongs to (null = unknown/legacy). */
  initialPositionVideoId: string | null;
}

interface ItemWithChannel extends PlaylistItemMeta {
  channel_name?: string | null;
}

const SAVE_INTERVAL_MS = 15000;
const POSITION_SAMPLE_MS = 5000;
const MAX_FOCUS_SECONDS = 86400;

/**
 * Solo learning workspace. Exactly one IFrame-API player instance drives
 * both single videos and playlist items (videoId switching, never nested
 * iframes). Focus seconds are an engagement measure — never proof of
 * attention, and never a reward for watching videos. The timer counts only
 * while: session studying + player confirmed PLAYING + tab visible + no
 * playback error, via bounded 1s segments. Progress persists every 15s
 * while counting, on pause/hide/switch, and on leave.
 */
export function WorkspacePage({
  profile,
  resourceId,
  title,
  channel,
  topic,
  parsedType,
  youtubeId,
  embeddable,
  playlistItems,
  playlistTruncated,
  initialFocusSeconds,
  initialPositionSeconds,
  initialPositionVideoId,
}: WorkspaceProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionState>(INITIAL_SESSION_STATE);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(initialFocusSeconds);
  const [positionSeconds, setPositionSeconds] = useState(initialPositionSeconds);
  const items = playlistItems;
  const isPlaylist = Boolean(items && items.length > 0);
  // Initial playlist selection: the remembered video from the import URL,
  // otherwise the first available item.
  const initialVideoId = isPlaylist
    ? items!.find((i) => i.available && i.video_id)?.video_id ?? null
    : parsedType === 'video'
      ? youtubeId
      : null;
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(initialVideoId);
  const [startSeconds, setStartSeconds] = useState(() =>
    resumePositionFor(initialPositionSeconds, initialPositionVideoId, initialVideoId)
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoplayNext, setAutoplayNext] = useState(false);
  const currentIndex = isPlaylist
    ? items!.findIndex((i) => i.video_id === currentVideoId)
    : -1;

  const playerRef = useRef<YTPlayer | null>(null);
  const sessionRef = useRef(session);
  // Latest playback position, tagged with the video id it belongs to.
  const positionRef = useRef({
    seconds: initialPositionSeconds,
    videoId: initialPositionVideoId ?? (parsedType === 'video' ? youtubeId : null),
  });
  // Live per-video positions seen this visit; supersedes the DB snapshot.
  const livePositionsRef = useRef(new Map<string, number>());
  const focusRef = useRef(focusSeconds);
  const dirtyRef = useRef(false);
  const activeVideoIdRef = useRef<string | null>(null);

  // The video the player should show right now. Single videos load their
  // own id; playlists load the selected item via videoId switching.
  const activeVideoId = isPlaylist
    ? currentVideoId
    : parsedType === 'video'
      ? youtubeId
      : null;
  activeVideoIdRef.current = activeVideoId;
  sessionRef.current = session;
  focusRef.current = focusSeconds;

  // ---- Persistence ----
  const save = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const { error } = await supabase.from('study_sessions').upsert(
      {
        resource_id: resourceId,
        focus_seconds: Math.min(MAX_FOCUS_SECONDS, Math.max(0, Math.floor(focusRef.current))),
        last_position_seconds: Math.min(
          MAX_FOCUS_SECONDS,
          Math.max(0, Math.floor(positionRef.current.seconds))
        ),
        last_video_id: positionRef.current.videoId,
        user_id: profile.id,
      },
      { onConflict: 'user_id,resource_id' }
    );
    if (error) {
      dirtyRef.current = true;
      setSaveError('Progress could not be saved. It will retry automatically.');
    } else {
      setSaveError(null);
      setSavedAt(new Date());
    }
  }, [profile.id, resourceId]);

  const saveRef = useRef(save);
  saveRef.current = save;

  /**
   * Sample getCurrentTime() and tag it with the given video. Fails safely
   * when the player is unavailable: the last known-good position is kept
   * rather than overwritten with zero.
   */
  const capturePosition = useCallback((videoId: string | null): boolean => {
    const player = playerRef.current;
    const t = player?.getCurrentTime();
    if (!player || typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      return false;
    }
    const seconds = Math.floor(t);
    positionRef.current = { seconds, videoId };
    if (videoId) livePositionsRef.current.set(videoId, seconds);
    setPositionSeconds(seconds);
    dirtyRef.current = true;
    return true;
  }, []);

  useEffect(() => {
    if (!isCounting(session)) return;
    const id = window.setInterval(() => void saveRef.current(), SAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    return () => {
      void saveRef.current();
    };
  }, []);

  // ---- Tab visibility: pause video + accounting; resume is deliberate ----
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        const prev = sessionRef.current;
        if (isCounting(prev) || prev.playing) {
          capturePosition(activeVideoIdRef.current);
          void saveRef.current();
          playerRef.current?.pauseVideo();
        }
        setSession(applyTabHidden);
      } else {
        // Returning to the tab does NOT auto-resume.
        setSession(applyTabVisible);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [capturePosition]);

  // ---- 1s focus segments: count only while every gate is open ----
  useEffect(() => {
    if (!isCounting(session)) return;
    const id = window.setInterval(() => {
      if (isCounting(sessionRef.current) && !document.hidden) {
        setFocusSeconds((s) => Math.min(MAX_FOCUS_SECONDS, s + 1));
        dirtyRef.current = true;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // ---- Position sampling while actually counting ----
  useEffect(() => {
    if (!isCounting(session)) return;
    const id = window.setInterval(() => {
      capturePosition(activeVideoIdRef.current);
    }, POSITION_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [session, capturePosition]);

  // ---- Player events ----
  function handleStateChange(state: number) {
    const prev = sessionRef.current;
    const next = applyPlayerState(prev, state);
    // Update the ref immediately so rapid event bursts never see stale state.
    sessionRef.current = next;
    setSession(next);
    if (state === PlayerState.PLAYING) {
      setPlayerError(null);
      capturePosition(activeVideoIdRef.current);
    } else if (state === PlayerState.PAUSED || state === PlayerState.ENDED) {
      if (isCounting(prev)) {
        capturePosition(activeVideoIdRef.current);
        void saveRef.current();
      }
    }
    // BUFFERING / CUED / UNSTARTED: no accrual, playing already cleared.
  }

  function handlePlayerError(_kind: string, message: string) {
    const next = applyPlayerError(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
    setPlayerError(message);
    void saveRef.current();
  }

  // YouTube told us at import time the owner forbids off-site playback —
  // never mount a player that can only end in error 101/150, and never
  // offer a Resume that cannot work.
  const blockedAtImport = embeddable === false && !isPlaylist;

  function startSession() {
    setAutoplayNext(true);
    const s = sessionRef.current;
    sessionRef.current = { ...s, phase: 'studying', playbackError: false };
    setSession(sessionRef.current);
    setPlayerError(null);
    playerRef.current?.playVideo();
  }

  function pauseSession() {
    if (isCounting(sessionRef.current)) {
      capturePosition(activeVideoIdRef.current);
      void saveRef.current();
    }
    playerRef.current?.pauseVideo();
    const next = applyPause(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
  }

  function selectItem(videoId: string) {
    if (!videoId || videoId === currentVideoId) return;
    const prev = sessionRef.current;
    if (isCounting(prev) || prev.playing) {
      capturePosition(activeVideoIdRef.current);
      void saveRef.current();
      playerRef.current?.pauseVideo();
    }
    // Resume the target video from its own saved position — never from the
    // previous item's timestamp.
    const targetSeconds =
      livePositionsRef.current.get(videoId) ??
      resumePositionFor(initialPositionSeconds, initialPositionVideoId, videoId);
    setStartSeconds(targetSeconds);
    setPositionSeconds(targetSeconds);
    positionRef.current = { seconds: targetSeconds, videoId };
    setAutoplayNext(false);
    setCurrentVideoId(videoId);
    const next: SessionState =
      prev.phase === 'ready'
        ? prev
        : { ...prev, phase: 'paused', playing: false };
    sessionRef.current = next;
    setSession(next);
  }

  function goPrevNext(delta: 1 | -1) {
    if (!isPlaylist) return;
    let i = currentIndex + delta;
    while (i >= 0 && i < items!.length) {
      if (items![i].available && items![i].video_id) {
        selectItem(items![i].video_id);
        return;
      }
      i += delta;
    }
  }

  const canPrev = isPlaylist && currentIndex > 0;
  const canNext =
    isPlaylist && currentIndex >= 0 && currentIndex < items!.length - 1;

  const currentChannel = useMemo(() => {
    if (!isPlaylist || currentIndex < 0) return channel;
    const item = items![currentIndex] as ItemWithChannel;
    return item.channel_name ?? channel;
  }, [isPlaylist, currentIndex, items, channel]);

  const displayTitle = topic?.trim() || title || 'Your lesson';
  const playbackUnavailable = blockedAtImport || Boolean(playerError);
  const counting = isCounting(session);
  const timerNote = playbackUnavailable
    ? 'Playback unavailable on this site — timer stopped'
    : counting
      ? 'Counting while the video plays'
      : session.phase === 'studying'
        ? 'Waiting for playback…'
        : session.phase === 'paused'
          ? 'Paused — press Resume to continue'
          : 'Press Start, then play the video';

  const watchUrlForPlayer = isPlaylist
    ? currentVideoId
      ? `https://www.youtube.com/watch?v=${currentVideoId}`
      : watchUrl({ type: 'playlist', id: youtubeId, sourceUrl: '' })
    : watchUrl({ type: 'video', id: youtubeId, sourceUrl: '' });

  return (
    <div className="animate-fade-up mx-auto max-w-6xl px-1">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Dashboard
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(`/rooms?link=${resourceId}`)}
            className="flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            title="Create a private study room around this lesson"
          >
            <Users className="h-4 w-4" aria-hidden />
            Study together
          </button>
          <a
            href={watchUrlForPlayer}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            title="Open on YouTube (creator and platform attribution preserved)"
          >
            View on YouTube
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Player column */}
        <div className="min-w-0">
          <YouTubePlayer
            videoId={blockedAtImport ? null : activeVideoId}
            autoplay={autoplayNext}
            startSeconds={startSeconds}
            watchUrl={watchUrlForPlayer}
            onStateChange={handleStateChange}
            onError={handlePlayerError}
            onReady={() => setPlayerError(null)}
          />

          {/* Current video title + honest channel attribution */}
          <div className="mt-4">
            <h1 className="font-display text-lg font-bold leading-snug text-ink sm:text-xl">
              {isPlaylist && currentIndex >= 0
                ? items![currentIndex].title ?? displayTitle
                : displayTitle}
            </h1>
            {currentChannel && (
              <p className="mt-1 text-sm text-ink-soft">
                {isPlaylist ? 'Video channel: ' : 'Channel: '}
                <span className="font-medium text-ink">{currentChannel}</span>
                {isPlaylist && channel && channel !== currentChannel && (
                  <span className="text-ink-faint"> · playlist curated by {channel}</span>
                )}
              </p>
            )}
            {topic?.trim() && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-faint">
                <Target className="h-3.5 w-3.5" aria-hidden />
                Study goal: {topic.trim()}
              </p>
            )}
          </div>

          {/* Compact focus-session panel near the player */}
          <section
            aria-label="Focus session"
            className="mt-4 rounded-2xl border border-line bg-raised p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
                  <Clock className="h-5 w-5 text-accent-strong" aria-hidden />
                </div>
                <div>
                  <p className="font-display text-2xl font-bold tabular-nums leading-none text-ink">
                    {formatDuration(focusSeconds)}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">{timerNote}</p>
                </div>
              </div>
              <div>
                {session.phase === 'studying' && !playbackUnavailable ? (
                  <Button variant="secondary" onClick={pauseSession}>
                    <Pause className="h-4 w-4" aria-hidden />
                    Pause session
                  </Button>
                ) : !playbackUnavailable ? (
                  <Button variant="primary" onClick={startSession}>
                    <Play className="h-4 w-4" aria-hidden />
                    {session.phase === 'paused' ? 'Resume session' : 'Start session'}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
              <span>Position {formatDuration(positionSeconds)}</span>
              {savedAt && <span>Saved {savedAt.toLocaleTimeString()}</span>}
            </div>
            {saveError && (
              <p className="mt-3 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
                {saveError}
              </p>
            )}
            {playerError && (
              <p className="mt-3 rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink-soft" role="alert">
                {playerError}
              </p>
            )}
            {blockedAtImport && (
              <p className="mt-3 rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink-soft" role="alert">
                The owner of this video does not allow it to play outside YouTube. Watch it there with the button above. Your study timer works on videos that allow embedding.
              </p>
            )}
          </section>
        </div>

        {/* Playlist panel: independently scrollable */}
        {isPlaylist && (
          <aside
            aria-label="Playlist videos"
            className="flex max-h-[560px] flex-col rounded-2xl border border-line bg-raised shadow-sm lg:row-span-2 lg:max-h-[calc(100vh-120px)]"
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
                <ListVideo className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span className="truncate">{title ?? 'Playlist'}</span>
              </h2>
              <span className="shrink-0 text-xs text-ink-faint">
                {currentIndex + 1} / {items!.length}
                {playlistTruncated ? '+' : ''}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <Button
                variant="secondary"
                disabled={!canPrev}
                onClick={() => goPrevNext(-1)}
                className="!px-3 !py-1.5 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Prev
              </Button>
              <span className="text-[11px] text-ink-faint">playlist order</span>
              <Button
                variant="secondary"
                disabled={!canNext}
                onClick={() => goPrevNext(1)}
                className="!px-3 !py-1.5 text-xs"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
              {items!.map((item, idx) => {
                const active = item.video_id === currentVideoId;
                const selectable = item.available && Boolean(item.video_id);
                return (
                  <li key={item.video_id || idx}>
                    <button
                      type="button"
                      disabled={!selectable}
                      onClick={() => selectable && selectItem(item.video_id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        active
                          ? 'bg-accent-soft'
                          : selectable
                            ? 'hover:bg-sunken'
                            : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <span
                        className={`w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums ${
                          active ? 'font-semibold text-accent-strong' : 'text-ink-faint'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`line-clamp-2 block text-xs leading-snug ${
                            active ? 'font-medium text-accent-strong' : 'text-ink'
                          }`}
                        >
                          {item.title ?? 'Unavailable video'}
                        </span>
                        {(item as ItemWithChannel).channel_name && (
                          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                            {(item as ItemWithChannel).channel_name}
                          </span>
                        )}
                        {!item.available && (
                          <span className="mt-0.5 block text-[11px] text-ink-soft">
                            Unavailable on YouTube
                          </span>
                        )}
                        {item.duration_seconds != null && item.duration_seconds > 0 && (
                          <span className="mt-0.5 block text-[11px] text-ink-faint">
                            {formatDuration(item.duration_seconds)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {playlistTruncated && (
              <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
                This playlist has more videos than we import (max 200). Open it
                on YouTube to see everything.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
