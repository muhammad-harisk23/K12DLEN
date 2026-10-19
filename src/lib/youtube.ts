export type YouTubeResourceType = 'video' | 'playlist';

export interface ParsedYouTubeUrl {
  type: YouTubeResourceType;
  id: string;
  /** Normalized canonical URL kept as the user submitted it (schema: https). */
  sourceUrl: string;
  /** Optional video within a playlist URL. */
  videoId?: string;
}

interface ParsedResult {
  parsed: ParsedYouTubeUrl;
  normalizedUrl: string;
}

/**
 * Parse and normalize a user-supplied YouTube URL. Supported shapes:
 *  - https://www.youtube.com/watch?v=<id>            (single video)
 *  - https://youtu.be/<id>                           (short link)
 *  - https://www.youtube.com/live/<id>               (live / premiere link)
 *  - https://www.youtube.com/playlist?list=<id>      (public playlist)
 *  - https://www.youtube.com/watch?v=<id>&list=<id>  (video-in-playlist;
 *    treated as the playlist with the video remembered)
 *
 * Only https links on youtube.com / youtu.be / music.youtube.com hosts are
 * accepted. Everything else — including embedding-free mimics like
 * youtube.com.evil.test or user:pass@ trickery — is rejected.
 */
export function parseYouTubeUrl(
  raw: string
): { ok: true } & ParsedResult | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Paste a YouTube link to continue.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: 'That does not look like a link. Paste a full YouTube URL, for example https://www.youtube.com/watch?v=...',
    };
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return {
      ok: false,
      reason: url.protocol !== 'https:'
        ? 'Only https:// YouTube links are supported.'
        : 'This link contains credentials, which YouTube URLs never do.',
    };
  }

  const host = url.hostname.toLowerCase();
  const isYoutube =
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be';
  if (!isYoutube) {
    return {
      ok: false,
      reason: 'That link is not a YouTube URL. Only youtube.com and youtu.be links are supported.',
    };
  }

  const vParam = url.searchParams.get('v');
  const listParam = url.searchParams.get('list');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    if (!/^[\w-]{11}$/.test(id)) {
      return { ok: false, reason: 'This short link does not contain a valid video id.' };
    }
    const normalized = listParam
      ? `https://www.youtube.com/watch?v=${id}&list=${listParam}`
      : `https://www.youtube.com/watch?v=${id}`;
    return {
      ok: true,
      parsed: {
        type: 'video',
        id,
        sourceUrl: normalized,
        ...(listParam ? { videoId: id } : {}),
      },
      normalizedUrl: normalized,
    };
  }

  const path = url.pathname.replace(/\/+$/, '');

  if (path.startsWith('/live/') || path.startsWith('/shorts/')) {
    const id = path.split('/')[2] ?? '';
    if (!/^[\w-]{11}$/.test(id)) {
      return {
        ok: false,
        reason:
          path === '/live'
            ? 'This live link does not contain a valid video id.'
            : 'This Shorts link does not contain a valid video id.',
      };
    }
    const normalized = `https://www.youtube.com/watch?v=${id}`;
    return {
      ok: true,
      parsed: { type: 'video', id, sourceUrl: normalized },
      normalizedUrl: normalized,
    };
  }

  if (path === '/playlist') {
    if (!listParam || !/^[\w-]{12,64}$/.test(listParam)) {
      return { ok: false, reason: 'This playlist link is missing a valid playlist id.' };
    }
    const normalized = `https://www.youtube.com/playlist?list=${listParam}`;
    return {
      ok: true,
      parsed: { type: 'playlist', id: listParam, sourceUrl: normalized },
      normalizedUrl: normalized,
    };
  }

  if (path === '/watch') {
    if (!vParam || !/^[\w-]{11}$/.test(vParam)) {
      return { ok: false, reason: 'This watch link is missing a valid video id.' };
    }
    if (listParam) {
      if (!/^[\w-]{12,64}$/.test(listParam)) {
        return { ok: false, reason: 'This link contains an invalid playlist id.' };
      }
      const normalized = `https://www.youtube.com/watch?v=${vParam}&list=${listParam}`;
      return {
        ok: true,
        parsed: {
          type: 'playlist',
          id: listParam,
          sourceUrl: normalized,
          videoId: vParam,
        },
        normalizedUrl: normalized,
      };
    }
    const normalized = `https://www.youtube.com/watch?v=${vParam}`;
    return {
      ok: true,
      parsed: { type: 'video', id: vParam, sourceUrl: normalized },
      normalizedUrl: normalized,
    };
  }

  return {
    ok: false,
    reason:
      'Unsupported YouTube link. Use a video link (youtube.com/watch?v=..., youtu.be/..., youtube.com/live/...), or a playlist link (youtube.com/playlist?list=...).',
  };
}

/**
 * Build the embed base used by the IFrame Player API. Never trust the raw
 * user URL for iframe src — only these canonical forms are constructible.
 */
export function embedSrc(parsed: ParsedYouTubeUrl): string {
  return parsed.type === 'video'
    ? `https://www.youtube.com/embed/${parsed.id}`
    : `https://www.youtube.com/embed/videoseries?list=${parsed.id}`;
}

/** Human-facing link back to YouTube for creator/platform attribution. */
export function watchUrl(parsed: ParsedYouTubeUrl): string {
  return parsed.type === 'video'
    ? `https://www.youtube.com/watch?v=${parsed.id}`
    : `https://www.youtube.com/playlist?list=${parsed.id}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
