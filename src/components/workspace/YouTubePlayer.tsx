import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import {
  PlayerErrorCode,
  PlayerState,
  loadYouTubeIframeApi,
} from '@/lib/youtubeIframeApi';
import type { YTPlayer } from '@/lib/youtubeIframeApi';

export type PlayerErrorKind =
  | 'network'
  | 'init'
  | 'browser'
  | 'origin'
  | 'invalid'
  | 'video'
  | 'embed';

interface YouTubePlayerProps {
  /** The exact video to load. Null with listId loads the playlist shell. */
  videoId: string | null;
  /** Playlist id fallback when item metadata is unavailable. */
  listId?: string | null;
  /** Play immediately on load (only true right after a user action). */
  autoplay: boolean;
  /** Resume position in seconds, applied when the video loads. */
  startSeconds?: number;
  /** Canonical YouTube watch URL for the fallback link. */
  watchUrl: string;
  onStateChange?: (state: number) => void;
  onError?: (kind: PlayerErrorKind, message: string) => void;
  onReady?: () => void;
}

const ERROR_MESSAGES: Record<number, { kind: PlayerErrorKind; message: string }> = {
  [PlayerErrorCode.INVALID_PARAMETER]: {
    kind: 'invalid',
    message: 'YouTube rejected this video. The link may be malformed.',
  },
  [PlayerErrorCode.HTML5_ERROR]: {
    kind: 'video',
    message: 'This video could not be played. Try again or pick another one.',
  },
  [PlayerErrorCode.NOT_FOUND]: {
    kind: 'video',
    message: 'This video is no longer available on YouTube.',
  },
  [PlayerErrorCode.PRIVATE]: {
    kind: 'embed',
    message: 'The owner has made this video private, so it cannot be played here.',
  },
  [PlayerErrorCode.EMBED_DISABLED]: {
    kind: 'embed',
    message:
      'The owner has disabled playing this video outside YouTube. Open it on YouTube instead.',
  },
};

/**
 * Official YouTube IFrame Player API wrapper.
 *
 * One player instance lives for the lifetime of the workspace; switching
 * videos reuses it via cueVideoById/loadVideoById instead of tearing the
 * iframe down. Handlers are read through refs so parent re-renders never
 * re-create the player. A watchdog classifies "ready never fired" as a
 * browser/security restriction (e.g. a COEP-restricted nested preview
 * frame) versus a genuine API failure.
 */
export function YouTubePlayer({
  videoId,
  listId,
  autoplay,
  startSeconds = 0,
  watchUrl,
  onStateChange,
  onError,
  onReady,
}: YouTubePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const autoplayRef = useRef(autoplay);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<PlayerErrorKind>('init');
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const cbRef = useRef({ onStateChange, onError, onReady });
  cbRef.current = { onStateChange, onError, onReady };
  autoplayRef.current = autoplay;
  const startRef = useRef(startSeconds);
  startRef.current = startSeconds;

  function fail(kind: PlayerErrorKind, message: string) {
    setStatus('error');
    setErrorKind(kind);
    setErrorMessage(message);
    cbRef.current.onError?.(kind, message);
  }

  useEffect(() => {
    let disposed = false;
    const isListShell = !videoId && Boolean(listId);
    const key = videoId ?? (listId ? `list:${listId}` : null);
    if (!key) return;
    setStatus('loading');
    setErrorMessage(null);

    // "Ready" that never arrives usually means the environment blocks the
    // nested YouTube frame (COEP/site-isolation) rather than a code bug.
    const watchdog = window.setTimeout(() => {
      if (!disposed && statusRef.current === 'loading') {
        fail(
          'browser',
          'The player could not start. This can happen when a browser or preview environment blocks embedded YouTube content. Open the app in its own browser tab, or use the button below to watch on YouTube.'
        );
      }
    }, 15000);

    (async () => {
      try {
        await loadYouTubeIframeApi();
      } catch (err) {
        if (disposed) return;
        fail(
          'network',
          err instanceof Error
            ? err.message
            : 'Could not reach YouTube. Check your connection and try again.'
        );
        return;
      }
      const YT = window.YT;
      if (disposed || !YT || !hostRef.current) return;

      const existing = playerRef.current;
      if (existing && loadedKeyRef.current && !isListShell && videoId) {
        // Same instance, new video: reuse instead of recreating the iframe.
        const load = autoplayRef.current ? existing.loadVideoById : existing.cueVideoById;
        load.call(existing, { videoId, startSeconds: startRef.current });
        loadedKeyRef.current = key;
        setStatus('ready');
        window.clearTimeout(watchdog);
        return;
      }

      const container = document.createElement('div');
      hostRef.current.innerHTML = '';
      hostRef.current.appendChild(container);

      try {
        const player = new YT.Player(container, {
          ...(videoId ? { videoId } : {}),
          playerVars: {
            ...(isListShell ? { list: listId!, listType: 'playlist' } : {}),
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (disposed) return;
              window.clearTimeout(watchdog);
              loadedKeyRef.current = key;
              setStatus('ready');
              // One-time resume: jump to the saved playback position when the
              // workspace loads a single video with prior progress.
              if (!isListShell && startRef.current > 0) {
                try {
                  playerRef.current?.seekTo(startRef.current, true);
                } catch {
                  // Seek is best-effort; playback starts from the top.
                }
                startRef.current = 0;
              }
              cbRef.current.onReady?.();
            },
            onStateChange: (event: { data: number }) => {
              if (disposed) return;
              cbRef.current.onStateChange?.(event.data);
            },
            onError: (event: { data: number }) => {
              if (disposed) return;
              const code = event.data;
              const mapped = ERROR_MESSAGES[code];
              // Include the raw code in the surfaced message so the exact
              // YouTube error (2/5/100/101/150) is always diagnosable.
              const detail = mapped
                ? `${mapped.message} (YouTube error ${code})`
                : `This item could not be played. It may be unavailable or not allowed outside YouTube. (YouTube error ${code})`;
              fail(mapped ? mapped.kind : 'video', detail);
            },
          },
        });
        playerRef.current = player;
      } catch (err) {
        if (disposed) return;
        fail(
          'init',
          err instanceof Error
            ? `The YouTube player failed to initialize: ${err.message}`
            : 'The YouTube player failed to initialize.'
        );
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(watchdog);
    };
  }, [videoId, listId, attempt]);

  // Tear the single player instance down on unmount only.
  useEffect(() => {
    return () => {
      try {
        playerRef.current?.destroy();
      } catch {
        // Best-effort teardown; the iframe may already be gone.
      }
      playerRef.current = null;
      loadedKeyRef.current = null;
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink shadow-sm">
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        {status === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-white/60" aria-hidden />
            <p className="max-w-md text-sm leading-relaxed text-white/90">
              {errorMessage}
            </p>
            {(errorKind === 'browser' || errorKind === 'network' || errorKind === 'init') && (
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
              >
                Try again
              </button>
            )}
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open on YouTube
            </a>
          </div>
        ) : (
          <>
            <div ref={hostRef} className="absolute inset-0" />
            {status === 'loading' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/60">
                <Loader2 className="h-6 w-6 animate-spin text-white" aria-label="Loading player" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { PlayerState };
