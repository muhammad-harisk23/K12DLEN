/**
 * Minimal ambient typing for the official YouTube IFrame Player API,
 * plus a one-time loader for https://www.youtube.com/iframe_api.
 */

interface YTPlayerOptions {
  videoId?: string;
  host?: string;
  playerVars?: Record<string, string | number | undefined>;
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onStateChange?: (event: { target: YTPlayer; data: number }) => void;
    onError?: (event: { target: YTPlayer; data: number }) => void;
  };
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayer;
      PlayerState: Record<string, number>;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export const PlayerErrorCode = {
  INVALID_PARAMETER: 2,
  HTML5_ERROR: 5,
  NOT_FOUND: 100,
  PRIVATE: 101,
  EMBED_DISABLED: 150,
} as const;

let apiPromise: Promise<void> | null = null;

/**
 * Load the official IFrame Player API script once, resolving when the
 * global YT object is ready. Rejects on network failure or timeout.
 */
export function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('The YouTube player took too long to load. Check your connection and try again.'));
    }, 15000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      apiPromise = null;
      reject(new Error('Could not reach YouTube. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}
