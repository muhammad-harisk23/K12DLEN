import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Link2,
  ListVideo,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Share2,
  Target,
  Users,
  X,
} from 'lucide-react';
import { YouTubePlayer } from '@/components/workspace/YouTubePlayer';
import { ConversationPanel } from '@/components/room/ConversationPanel';
import { VideoSlot } from '@/components/room/VideoSlot';
import { Button } from '@/components/ui/Button';
import { fetchRoomDashboard, updateRoomMissionSecure, leaveRoomSecure, createRoomInviteSecure } from '@/lib/rooms';
import type { RoomDashboard, PlaylistItemMeta } from '@/lib/rooms';
import { formatDuration } from '@/lib/youtube';
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
import { supabase } from '@/lib/supabase';
import type { StudentProfile } from '@/types/curriculum';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITION_SAMPLE_MS = 5000;
const MAX_FOCUS_SECONDS = 86400;
const YT_VIDEO_RE = /^[A-Za-z0-9_-]{6,20}$/;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

interface RoomPageProps {
  profile: StudentProfile;
  roomId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'missing' }
  | { status: 'ready' };

type MobileTab = 'playlist' | 'chat';

interface ItemWithChannel extends PlaylistItemMeta {
  channel_name?: string | null;
  embeddable?: boolean;
}

export function RoomPage({ profile, roomId }: RoomPageProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [room, setRoom] = useState<RoomDashboard | null>(null);

  const [session, setSession] = useState<SessionState>(INITIAL_SESSION_STATE);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [startSeconds, setStartSeconds] = useState(0);
  const [savedMission, setSavedMission] = useState<string | null>(null);
  const [missionDraft, setMissionDraft] = useState('');
  const [missionError, setMissionError] = useState<string | null>(null);
  const [missionSavedAt, setMissionSavedAt] = useState<Date | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showMission, setShowMission] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const playerRef = useRef<YTPlayer | null>(null);
  const sessionRef = useRef(session);
  const positionRef = useRef({ seconds: 0, videoId: null as string | null });
  const dirtyRef = useRef(false);
  const focusRef = useRef(0);
  const activeVideoIdRef = useRef<string | null>(null);
  const livePositionsRef = useRef(new Map<string, number>());
  const initialPositionRef = useRef({ seconds: 0, videoId: null as string | null });

  sessionRef.current = session;
  focusRef.current = focusSeconds;

  useEffect(() => {
    if (!UUID_RE.test(roomId)) {
      setLoad({ status: 'missing' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dashboard = await fetchRoomDashboard(roomId);
        if (cancelled) return;
        setRoom(dashboard);
        setSavedMission(dashboard.mission);
        setMissionDraft(dashboard.mission);
        setLoad({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        setLoad(
          msg.includes('not a member') || msg.includes('session expired')
            ? { status: 'denied' }
            : { status: 'missing' }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (load.status !== 'ready' || !room?.lesson) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('study_sessions')
          .select('focus_seconds, last_position_seconds, last_video_id')
          .eq('resource_id', room.lesson!.id)
          .maybeSingle();
        if (cancelled || !data) return;
        const fs = typeof data.focus_seconds === 'number' ? data.focus_seconds : 0;
        const ps = Number(data.last_position_seconds ?? 0);
        const vid = typeof data.last_video_id === 'string' ? data.last_video_id : null;
        setFocusSeconds(Math.min(MAX_FOCUS_SECONDS, Math.max(0, Math.floor(fs))));
        focusRef.current = Math.min(MAX_FOCUS_SECONDS, Math.max(0, Math.floor(fs)));
        initialPositionRef.current = { seconds: Math.floor(ps), videoId: vid };
        positionRef.current = { seconds: Math.floor(ps), videoId: vid };
        setPositionSeconds(Math.floor(ps));
      } catch {
        // Saved progress is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load.status, room?.lesson?.id]);

  useEffect(() => {
    if (!room || load.status !== 'ready') return;
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'study_rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          const next = payload.new as { title: string; goal_text: string };
          setRoom((r) => (r ? { ...r, title: next.title, mission: next.goal_text } : r));
          setSavedMission(next.goal_text);
          setMissionDraft(next.goal_text);
          setMissionSavedAt(new Date());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
        () => {
          void fetchRoomDashboard(roomId)
            .then((dashboard) => {
              if (dashboard.participants.some((p) => p.userId === profile.id)) {
                setRoom(dashboard);
              } else {
                setLoad({ status: 'denied' });
              }
            })
            .catch(() => undefined);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room, load.status, roomId, profile.id]);

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

  useEffect(() => {
    if (!isCounting(session)) return;
    const id = window.setInterval(() => {
      const t = playerRef.current?.getCurrentTime();
      if (typeof t === 'number' && Number.isFinite(t) && t >= 0) {
        const secs = Math.floor(t);
        positionRef.current = { seconds: secs, videoId: activeVideoIdRef.current };
        if (activeVideoIdRef.current) livePositionsRef.current.set(activeVideoIdRef.current, secs);
        setPositionSeconds(secs);
        dirtyRef.current = true;
      }
    }, POSITION_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    return () => {
      void playerRef.current?.pauseVideo();
      void saveProgress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        if (isCounting(sessionRef.current) || sessionRef.current.playing) {
          capturePosition(activeVideoIdRef.current);
          void saveProgress();
          playerRef.current?.pauseVideo();
        }
        setSession(applyTabHidden);
      } else {
        setSession(applyTabVisible);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capturePosition(videoId: string | null): boolean {
    const player = playerRef.current;
    const t = player?.getCurrentTime();
    if (!player || typeof t !== 'number' || !Number.isFinite(t) || t < 0) return false;
    const secs = Math.floor(t);
    positionRef.current = { seconds: secs, videoId };
    if (videoId) livePositionsRef.current.set(videoId, secs);
    setPositionSeconds(secs);
    dirtyRef.current = true;
    return true;
  }

  async function saveProgress() {
    if (!dirtyRef.current || !room?.lesson) return;
    dirtyRef.current = false;
    const resourceId = room.lesson.id;
    const { error } = await supabase.from('study_sessions').upsert(
      {
        resource_id: resourceId,
        focus_seconds: Math.min(MAX_FOCUS_SECONDS, Math.max(0, Math.floor(focusRef.current))),
        last_position_seconds: Math.min(MAX_FOCUS_SECONDS, Math.max(0, Math.floor(positionRef.current.seconds))),
        last_video_id: positionRef.current.videoId,
        user_id: profile.id,
      },
      { onConflict: 'user_id,resource_id' }
    );
    if (error) dirtyRef.current = true;
  }

  function handleStateChange(state: number) {
    const prev = sessionRef.current;
    const next = applyPlayerState(prev, state);
    sessionRef.current = next;
    setSession(next);
    if (state === PlayerState.PLAYING) {
      setPlayerError(null);
      capturePosition(activeVideoIdRef.current);
    } else if (state === PlayerState.PAUSED || state === PlayerState.ENDED) {
      if (isCounting(prev)) {
        capturePosition(activeVideoIdRef.current);
        void saveProgress();
      }
    }
  }

  function handlePlayerError(_kind: string, message: string) {
    const next = applyPlayerError(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
    setPlayerError(message);
    void saveProgress();
  }

  function startSession() {
    const s = sessionRef.current;
    sessionRef.current = { ...s, phase: 'studying', playbackError: false };
    setSession(sessionRef.current);
    setPlayerError(null);
    playerRef.current?.playVideo();
  }

  function pauseSession() {
    if (isCounting(sessionRef.current)) {
      capturePosition(activeVideoIdRef.current);
      void saveProgress();
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
      void saveProgress();
      playerRef.current?.pauseVideo();
    }
    const targetSeconds =
      livePositionsRef.current.get(videoId) ??
      resumePositionFor(initialPositionRef.current.seconds, initialPositionRef.current.videoId, videoId);
    setStartSeconds(targetSeconds);
    setPositionSeconds(targetSeconds);
    positionRef.current = { seconds: targetSeconds, videoId };
    setCurrentVideoId(videoId);
    const next: SessionState =
      prev.phase === 'ready' ? prev : { ...prev, phase: 'paused', playing: false };
    sessionRef.current = next;
    setSession(next);
  }

  async function handleSaveMission(e: React.FormEvent) {
    e.preventDefault();
    setMissionError(null);
    const clean = missionDraft.trim();
    if (clean.length > 280) {
      setMissionError('Keep the mission to 280 characters or fewer.');
      return;
    }
    try {
      await updateRoomMissionSecure(roomId, clean);
      setSavedMission(clean);
      setMissionSavedAt(new Date());
    } catch (err) {
      setMissionError(err instanceof Error ? err.message : 'Could not save the mission.');
    }
  }

  async function handleLeave() {
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveRoomSecure(roomId);
      navigate('/rooms');
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : 'Could not leave the room.');
      setLeaving(false);
    }
  }

  async function handleCreateInvite() {
    setInviteBusy(true);
    setInviteError(null);
    setCopied(false);
    try {
      const code = await createRoomInviteSecure(roomId, 168);
      setInviteLink(`${window.location.origin}/invite/${code}`);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not create an invite.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleCopyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const lesson = room?.lesson ?? null;
  const playlistItems: PlaylistItemMeta[] | null = useMemo(() => {
    if (!lesson || lesson.sourceType !== 'playlist') return null;
    const items = (lesson.playlistItems ?? []) as ItemWithChannel[];
    if (items.length === 0) return null;
    return items.map((i) => ({
      position: i.position,
      video_id: i.video_id,
      title: i.title,
      available: i.available !== false,
      duration_seconds: i.duration_seconds ?? null,
    }));
  }, [lesson]);
  const playlistItemsWithChannel: ItemWithChannel[] | null = useMemo(() => {
    if (!lesson || lesson.sourceType !== 'playlist') return null;
    const items = (lesson.playlistItems ?? []) as ItemWithChannel[];
    if (items.length === 0) return null;
    return items;
  }, [lesson]);

  const isPlaylist = Boolean(playlistItems && playlistItems.length > 0);
  const initialVideoId = isPlaylist
    ? playlistItems!.find((i) => i.available && YT_VIDEO_RE.test(i.video_id))?.video_id ?? null
    : lesson?.sourceType === 'video'
      ? lesson.youtubeId
      : null;

  useEffect(() => {
    if (initialVideoId && currentVideoId === null) {
      const target = initialVideoId;
      const resume = resumePositionFor(
        initialPositionRef.current.seconds,
        initialPositionRef.current.videoId,
        target
      );
      setStartSeconds(resume);
      setPositionSeconds(resume);
      positionRef.current = { seconds: resume, videoId: target };
      setCurrentVideoId(target);
    }
  }, [initialVideoId, currentVideoId]);

  const playerVideoId = isPlaylist ? currentVideoId : lesson?.sourceType === 'video' ? lesson.youtubeId : null;
  activeVideoIdRef.current = playerVideoId;

  const currentIndex = isPlaylist && currentVideoId
    ? playlistItems!.findIndex((i) => i.video_id === currentVideoId)
    : -1;

  const currentVideoTitle = useMemo(() => {
    if (isPlaylist && currentIndex >= 0) {
      return playlistItems![currentIndex].title ?? lesson?.title ?? null;
    }
    if (lesson?.sourceType === 'video') return lesson.topic?.trim() || lesson.title || null;
    return lesson?.title ?? null;
  }, [isPlaylist, currentIndex, playlistItems, lesson]);

  const currentChannel = useMemo(() => {
    if (isPlaylist && currentIndex >= 0 && playlistItemsWithChannel) {
      const item = playlistItemsWithChannel[currentIndex];
      return item.channel_name ?? lesson?.channel ?? null;
    }
    return lesson?.channel ?? null;
  }, [isPlaylist, currentIndex, playlistItemsWithChannel, lesson]);

  const canPrev = isPlaylist && currentIndex > 0;
  const canNext = isPlaylist && currentIndex >= 0 && currentIndex < playlistItems!.length - 1;

  function goPrevNext(delta: 1 | -1) {
    if (!isPlaylist || !playlistItems) return;
    let i = currentIndex + delta;
    while (i >= 0 && i < playlistItems.length) {
      const it = playlistItems[i];
      if (it.available && YT_VIDEO_RE.test(it.video_id)) {
        selectItem(it.video_id);
        return;
      }
      i += delta;
    }
  }

  const missionDirty = missionDraft.trim() !== (savedMission ?? '').trim();
  const counting = isCounting(session);
  const playbackUnavailable = Boolean(playerError);
  const playlistTruncated = Boolean(lesson?.playlistTruncated);

  const watchUrl = lesson
    ? lesson.sourceType === 'video'
      ? `https://www.youtube.com/watch?v=${lesson.youtubeId}`
      : currentVideoId
        ? `https://www.youtube.com/watch?v=${currentVideoId}`
        : `https://www.youtube.com/playlist?list=${lesson.youtubeId}`
    : '';

  if (load.status === 'loading') {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading room" />
      </div>
    );
  }

  if (load.status === 'denied' || load.status === 'missing' || !room) {
    const denied = load.status === 'denied';
    return (
      <div className="flex h-[100dvh] flex-col bg-surface">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
          <button
            type="button"
            onClick={() => navigate('/rooms')}
            className="flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to rooms
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
            <h1 className="font-display text-lg font-bold text-ink">
              {denied ? "You're not a member of this room" : 'Room not found'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {denied
                ? 'Study rooms are private. Ask the owner to share an invitation link with you.'
                : "This study room doesn't exist, or the link belongs to another account."}
            </p>
            <Link
              to="/rooms"
              className="mt-5 flex min-h-touch items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-colors hover:bg-accent-strong"
            >
              Back to my rooms
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const myParticipant = room.participants.find((p) => p.userId === profile.id);
  const isOwner = myParticipant?.role === 'owner';
  const displayTitle = lesson?.topic?.trim() || lesson?.title || 'Shared lesson';
  const timerNote = playbackUnavailable
    ? 'Playback unavailable, timer stopped'
    : counting
      ? 'Counting while the video plays'
      : session.phase === 'studying'
        ? 'Waiting for playback'
        : session.phase === 'paused'
          ? 'Paused, press Resume to continue'
          : 'Start a session, then play your lesson';

  const playlistPanel = isPlaylist ? (
    <aside
      aria-label="Playlist videos"
      className="flex h-full min-h-0 flex-col"
    >
      {canPrev || canNext ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
          <Button
            variant="secondary"
            disabled={!canPrev}
            onClick={() => goPrevNext(-1)}
            className="!px-3 !py-1.5 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Prev
          </Button>
          <span className="text-[11px] text-ink-faint">
            {currentIndex >= 0 ? `${currentIndex + 1} / ${playlistItems!.length}` : `${playlistItems!.length}`}
            {playlistTruncated ? '+' : ''}
          </span>
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
      ) : null}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {playlistItems!.map((item, idx) => {
          const active = item.video_id === currentVideoId;
          const selectable = item.available && Boolean(item.video_id) && YT_VIDEO_RE.test(item.video_id);
          const withChannel = playlistItemsWithChannel?.[idx];
          return (
            <li key={item.video_id || idx}>
              <button
                type="button"
                disabled={!selectable}
                onClick={() => selectable && selectItem(item.video_id)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-accent-soft' : selectable ? 'hover:bg-sunken' : 'cursor-not-allowed opacity-50'
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
                  {withChannel?.channel_name && (
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {withChannel.channel_name}
                    </span>
                  )}
                  {!item.available && (
                    <span className="mt-0.5 block text-[11px] text-ink-soft">Unavailable on YouTube</span>
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
        <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
          This playlist has more videos than we import. Open it on YouTube to see everything.
        </p>
      )}
    </aside>
  ) : null;

  const playerBlock = lesson ? (
    <YouTubePlayer
      videoId={playerVideoId}
      autoplay={false}
      startSeconds={startSeconds}
      watchUrl={watchUrl}
      onStateChange={handleStateChange}
      onError={handlePlayerError}
      onReady={() => setPlayerError(null)}
      className="h-full w-full overflow-hidden rounded-2xl border border-line bg-ink shadow-sm"
    />
  ) : null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-surface">
      {/* ===== Compact room toolbar ===== */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <button
          type="button"
          onClick={() => navigate('/rooms')}
          className="flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          aria-label="Back to rooms"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Rooms</span>
        </button>
        <div className="h-5 w-px shrink-0 bg-line" aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <h1 className="truncate font-display text-sm font-bold text-ink">{room.title}</h1>
          <span className="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-ink-faint sm:inline">
            Private
          </span>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {room.participants.length} {room.participants.length === 1 ? 'member' : 'members'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isPlaylist && (
            <button
              type="button"
              onClick={() => setShowPlaylist(true)}
              className="flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              <ListVideo className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Playlist</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMission(true)}
            className="flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          >
            <Target className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Mission</span>
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className="flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Invite</span>
            </button>
          )}
          {!isOwner && (
            <button
              type="button"
              onClick={() => void handleLeave()}
              disabled={leaving}
              className="flex min-h-touch items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              Leave
            </button>
          )}
        </div>
      </header>

      {/* ===== Desktop: one-screen split workspace ===== */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,38%)]">
        {/* Left: video + info + focus */}
        <div className="flex min-h-0 min-w-0 flex-col">
          <VideoSlot className="min-h-0 flex-1 p-3">
            {playerBlock ?? (
              <div className="flex h-full w-full items-center justify-center">
                <div className="rounded-2xl border border-dashed border-line-strong bg-raised/60 px-6 py-10 text-center">
                  <Link2 className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
                  <p className="mt-3 text-sm font-medium text-ink">No lesson linked</p>
                  <p className="mt-1 text-sm text-ink-soft">The owner can link one from a saved lesson.</p>
                </div>
              </div>
            )}
          </VideoSlot>

          <div className="shrink-0 border-t border-line px-4 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-sm font-bold text-ink">
                  {isPlaylist && currentIndex >= 0
                    ? playlistItems![currentIndex].title ?? displayTitle
                    : displayTitle}
                </h2>
                {currentChannel && (
                  <p className="truncate text-xs text-ink-soft">{currentChannel}</p>
                )}
              </div>
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-touch shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                YouTube
              </a>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft">
                  <Clock className="h-4 w-4 text-accent-strong" aria-hidden />
                </div>
                <div>
                  <p className="font-display text-lg font-bold tabular-nums leading-none text-ink">
                    {formatDuration(focusSeconds)}
                  </p>
                  <p className="text-[10px] text-ink-faint">{timerNote}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-ink-faint">
                  {formatDuration(positionSeconds)}
                </span>
                {counting && !playbackUnavailable ? (
                  <Button variant="secondary" onClick={pauseSession} className="!px-3 !py-1.5 text-xs">
                    <Pause className="h-3.5 w-3.5" aria-hidden />
                    Pause
                  </Button>
                ) : !playbackUnavailable ? (
                  <Button variant="primary" onClick={startSession} className="!px-3 !py-1.5 text-xs">
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    {session.phase === 'paused' ? 'Resume' : 'Start'}
                  </Button>
                ) : null}
              </div>
            </div>
            {playerError && (
              <p className="mt-2 text-xs text-ink-soft" role="alert">{playerError}</p>
            )}
          </div>
        </div>

        {/* Right: shared AI chat */}
        <div className="min-h-0 border-l border-line">
          <ConversationPanel
            roomId={roomId}
            profile={profile}
            roomReady={true}
            currentVideoTitle={currentVideoTitle}
            currentVideoId={playerVideoId}
            fillHeight
          />
        </div>
      </div>

      {/* ===== Mobile: stacked workspace with tabs ===== */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        {/* Video: 16:9, stays mounted */}
        <div className="shrink-0 p-2">
          <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
            {playerBlock ?? (
              <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-line-strong bg-raised/60 text-center">
                <p className="text-sm text-ink-soft">No lesson linked</p>
              </div>
            )}
          </div>
        </div>

        {/* Compact focus bar */}
        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-ink-soft" aria-hidden />
              <span className="font-display text-base font-bold tabular-nums text-ink">
                {formatDuration(focusSeconds)}
              </span>
              <span className="text-[10px] text-ink-faint">{timerNote}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {counting && !playbackUnavailable ? (
                <Button variant="secondary" onClick={pauseSession} className="!px-3 !py-1.5 text-xs">
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  Pause
                </Button>
              ) : !playbackUnavailable ? (
                <Button variant="primary" onClick={startSession} className="!px-3 !py-1.5 text-xs">
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {session.phase === 'paused' ? 'Resume' : 'Start'}
                </Button>
              ) : null}
            </div>
          </div>
          {playerError && (
            <p className="mt-1.5 text-xs text-ink-soft" role="alert">{playerError}</p>
          )}
        </div>

        {/* Tabbed panels: AI / Playlist */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-line bg-raised p-1" role="tablist" aria-label="Room panels">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'chat'}
              onClick={() => setMobileTab('chat')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mobileTab === 'chat' ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft'
              }`}
            >
              <MessageSquare className="h-4 w-4" aria-hidden />
              AI
            </button>
            {isPlaylist && (
              <button
                type="button"
                role="tab"
                aria-selected={mobileTab === 'playlist'}
                onClick={() => setMobileTab('playlist')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mobileTab === 'playlist' ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft'
                }`}
              >
                <ListVideo className="h-4 w-4" aria-hidden />
                Playlist
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {mobileTab === 'playlist' && isPlaylist ? (
              <div className="h-full border border-line bg-raised shadow-sm">{playlistPanel}</div>
            ) : (
              <ConversationPanel
                roomId={roomId}
                profile={profile}
                roomReady={true}
                currentVideoTitle={currentVideoTitle}
                currentVideoId={playerVideoId}
                fillHeight
              />
            )}
          </div>
        </div>
      </div>

      {/* ===== Playlist drawer (desktop overlay) ===== */}
      {showPlaylist && isPlaylist && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="Playlist" aria-modal="true">
          <div className="flex-1 bg-ink/40 backdrop-blur-sm" onClick={() => setShowPlaylist(false)} />
          <div className="flex w-full max-w-md flex-col border-l border-line bg-surface shadow-lifted">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <h2 className="flex min-w-0 items-center gap-2 font-display text-sm font-bold text-ink">
                <ListVideo className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{lesson?.title ?? 'Playlist'}</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowPlaylist(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Close playlist"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{playlistPanel}</div>
          </div>
        </div>
      )}

      {/* ===== Mission modal ===== */}
      {showMission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Shared mission" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setShowMission(false)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-line bg-surface shadow-lifted">
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink">
                <Target className="h-4 w-4" aria-hidden />
                Shared mission
              </h2>
              <button
                type="button"
                onClick={() => setShowMission(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Close mission"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <form onSubmit={handleSaveMission}>
                <label htmlFor="shared-mission" className="text-sm font-medium text-ink">
                  Set a goal for your study room
                </label>
                <textarea
                  id="shared-mission"
                  value={missionDraft}
                  onChange={(e) => setMissionDraft(e.target.value)}
                  maxLength={280}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-faint">
                    {missionSavedAt && !missionDirty
                      ? `Saved ${missionSavedAt.toLocaleTimeString()}`
                      : `${missionDraft.length}/280`}
                  </span>
                  <Button type="submit" disabled={!missionDirty} loading={false}>
                    Save mission
                  </Button>
                </div>
                {missionError && (
                  <p className="mt-3 text-sm text-ink" role="alert">{missionError}</p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ===== Invite modal (owner only) ===== */}
      {showInvite && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Invite a classmate" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface shadow-lifted">
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink">
                <Share2 className="h-4 w-4" aria-hidden />
                Invite a classmate
              </h2>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Close invite"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              {inviteLink ? (
                <div className="space-y-3">
                  <p className="break-all rounded-xl bg-sunken px-3.5 py-2.5 text-xs leading-relaxed text-ink-soft">
                    {inviteLink}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => void handleCopyInvite()}>
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(`Join my study room: ${inviteLink}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-touch items-center rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-line-strong"
                    >
                      WhatsApp
                    </a>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Join my study room')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-touch items-center rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-line-strong"
                    >
                      Telegram
                    </a>
                  </div>
                  <p className="text-xs text-ink-faint">Works for 7 days, up to 8 members.</p>
                </div>
              ) : (
                <Button onClick={() => void handleCreateInvite()} loading={inviteBusy}>
                  Create invitation link
                </Button>
              )}
              {inviteError && (
                <p className="mt-3 text-sm text-ink" role="alert">{inviteError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leave error toast */}
      {leaveError && (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line-strong bg-raised px-4 py-3 text-sm text-ink shadow-lifted"
          role="alert"
        >
          {leaveError}
        </div>
      )}
    </div>
  );
}
