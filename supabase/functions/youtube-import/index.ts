// youtube-import edge function — Gate 1A real YouTube Data API v3 import.
//
// POST { url: string, topic?: string }
// Auth: requires a valid Supabase user JWT (verify_jwt = true).
// Validates the URL against strict host/ID allowlists, enforces a per-user
// rolling-window rate limit, calls the YouTube Data API with the
// YOUTUBE_API_KEY secret (never returned or logged), and persists the
// resource + ordered playlist items with the service role.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ---------------------------------------------------------------------------
// YouTube Data API v3 helpers
// ---------------------------------------------------------------------------

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = 8000;
const IMPORT_CAP = 200;

interface YtVideoMeta {
  id: string;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  duration_seconds: number | null;
  embeddable: boolean;
  privacy: 'public' | 'unlisted' | 'private' | 'unknown';
  upload_status: string | null;
}

interface YtPlaylistItem {
  position: number;
  videoId: string;
  itemId: string;
  title: string | null;
  thumbnail: string | null;
  meta: YtVideoMeta | null;
}

class YtApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function ytFetch<T>(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string
): Promise<T> {
  const url = new URL(`${YT_API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      let reason = `YouTube API error ${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { message?: string; errors?: { reason?: string }[] };
        };
        const apiReason = body.error?.errors?.[0]?.reason;
        if (res.status === 403 && apiReason === 'quotaExceeded') {
          reason = 'YouTube API quota is exhausted. Try again later.';
        } else if (res.status === 403 && apiReason === 'ipRefererBlocked') {
          reason = 'The YouTube API key is not allowed to call from this server.';
        } else if (body.error?.message) {
          reason = `YouTube API error ${res.status}: ${body.error.message}`;
        }
      } catch {
        // Non-JSON error body; keep the generic reason.
      }
      throw new YtApiError(reason, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof YtApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new YtApiError('The YouTube API request timed out.', 504);
    }
    throw new YtApiError('Could not reach the YouTube API.', 502);
  } finally {
    clearTimeout(timer);
  }
}

function parseIsoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const d = m[1] ? parseInt(m[1], 10) * 86400 : 0;
  const h = m[2] ? parseInt(m[2], 10) * 3600 : 0;
  const min = m[3] ? parseInt(m[3], 10) * 60 : 0;
  const s = m[4] ? parseInt(m[4], 10) : 0;
  return d + h + min + s;
}

function bestThumb(
  thumbnails: Record<string, { url?: string }> | undefined
): string | null {
  if (!thumbnails) return null;
  return (
    thumbnails.medium?.url ??
    thumbnails.high?.url ??
    thumbnails.default?.url ??
    thumbnails.standard?.url ??
    thumbnails.maxres?.url ??
    null
  );
}

// ---------------------------------------------------------------------------

const RATE_WINDOW_MINUTES = 10;
const RATE_MAX_IMPORTS = 30;

const VIDEO_ID_RE = /^[\w-]{11}$/;
const PLAYLIST_ID_RE = /^[\w-]{12,64}$/;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return json(405, { error: 'Method not allowed.' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(401, { error: 'Sign in to import lessons.' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const apiKey = Deno.env.get('YOUTUBE_API_KEY');
    if (!apiKey) {
      console.error('youtube-import: YOUTUBE_API_KEY secret missing');
      return json(500, { error: 'The YouTube integration is not configured.' });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json(401, { error: 'Sign in to import lessons.' });
    }
    const userId = userData.user.id;

    // --- Rate limit (rolling window) ---
    const windowStart = new Date(
      Date.now() - RATE_WINDOW_MINUTES * 60_000
    ).toISOString();
    const { count, error: rateError } = await admin
      .from('import_rate_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', windowStart);
    if (rateError) {
      console.error('rate log query failed', rateError.message);
      return json(500, { error: 'Could not start the import. Please try again.' });
    }
    if ((count ?? 0) >= RATE_MAX_IMPORTS) {
      return json(429, {
        error: `Too many imports in a short time. Try again in ${RATE_WINDOW_MINUTES} minutes.`,
      });
    }

    // --- Input validation ---
    let body: { url?: unknown; topic?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Invalid request body.' });
    }
    if (typeof body.url !== 'string') {
      return json(400, { error: 'Paste a YouTube link to import.' });
    }
    const topic =
      typeof body.topic === 'string' && body.topic.trim()
        ? body.topic.trim().slice(0, 120)
        : null;

    // URL allowlist validation
    const parsed = (() => {
      const raw = body.url as string;
      if (raw.length > 2048) return { error: 'That link is too long or malformed.' };
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        return { error: 'That does not look like a link. Paste a full YouTube URL.' };
      }
      if (url.protocol !== 'https:') {
        return { error: 'Only https:// YouTube links are supported.' };
      }
      const host = url.hostname.toLowerCase();
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
        return { error: 'Only youtube.com and youtu.be links are supported.' };
      }
      const v = url.searchParams.get('v');
      const list = url.searchParams.get('list');
      const path = url.pathname.replace(/\/+$/, '');

      if (host === 'youtu.be') {
        const id = url.pathname.replace(/^\/+/, '').split('/')[0];
        if (!VIDEO_ID_RE.test(id)) return { error: 'This short link does not contain a valid video id.' };
        return {
          type: 'video' as const,
          id,
          normalizedUrl: `https://www.youtube.com/watch?v=${id}`,
        };
      }
      if (path === '/watch') {
        if (!v || !VIDEO_ID_RE.test(v)) return { error: 'This watch link is missing a valid video id.' };
        if (list && PLAYLIST_ID_RE.test(list)) {
          return {
            type: 'playlist' as const,
            id: list,
            normalizedUrl: `https://www.youtube.com/watch?v=${v}&list=${list}`,
            videoId: v,
          };
        }
        return { type: 'video' as const, id: v, normalizedUrl: `https://www.youtube.com/watch?v=${v}` };
      }
      if (path === '/playlist') {
        if (!list || !PLAYLIST_ID_RE.test(list)) return { error: 'This playlist link is missing a valid playlist id.' };
        return { type: 'playlist' as const, id: list, normalizedUrl: `https://www.youtube.com/playlist?list=${list}` };
      }
      if (path.startsWith('/live/') || path.startsWith('/shorts/')) {
        const id = path.split('/')[2] ?? '';
        if (!VIDEO_ID_RE.test(id)) {
          return {
            error:
              path.startsWith('/live')
                ? 'This live link does not contain a valid video id.'
                : 'This Shorts link does not contain a valid video id.',
          };
        }
        return { type: 'video' as const, id, normalizedUrl: `https://www.youtube.com/watch?v=${id}` };
      }
      return {
        error:
          'Unsupported YouTube link. Use a video link (youtube.com/watch?v=..., youtu.be/..., youtube.com/live/...), or a playlist link (youtube.com/playlist?list=...).',
      };
    })();

    if ('error' in parsed) {
      return json(400, { error: parsed.error });
    }

    // --- YouTube Data API calls ---
    const nowIso = new Date().toISOString();
    // YouTube API ToS: stored data must be refreshed or deleted within 30 days.
    const expiresIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    let resource: Record<string, unknown>;

    if (parsed.type === 'video') {
      // videos.list with a known ID (never search.list)
      const res = await ytFetch<{
        items?: {
          id: string;
          snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
          contentDetails?: { duration?: string };
          status?: { privacyStatus?: string; embeddable?: boolean; uploadStatus?: string };
        }[];
      }>(
        'videos',
        { part: 'snippet,contentDetails,status', id: parsed.id, maxResults: '1' },
        apiKey
      );
      const item = res.items?.[0];
      if (!item) {
        return json(404, {
          error: 'This video does not exist or is private. Check the link and try again.',
        });
      }
      const privacy = (item.status?.privacyStatus ?? 'unknown') as YtVideoMeta['privacy'];
      resource = {
        source_type: 'video',
        youtube_id: parsed.id,
        source_url: parsed.normalizedUrl,
        title: item.snippet?.title ?? null,
        channel_name: item.snippet?.channelTitle ?? null,
        thumbnail_url: bestThumb(item.snippet?.thumbnails),
        import_state:
          privacy === 'private' || item.status?.uploadStatus === 'deleted' ? 'failed' : 'ready',
        metadata: {
          duration_seconds: item.contentDetails?.duration
            ? parseIsoDuration(item.contentDetails.duration)
            : null,
          embeddable: item.status?.embeddable !== false,
          privacy_status: privacy,
          upload_status: item.status?.uploadStatus ?? null,
        },
      };
    } else {
      // playlists.list for the playlist itself
      const plRes = await ytFetch<{
        items?: {
          id: string;
          snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
          contentDetails?: { itemCount?: number };
          status?: { privacyStatus?: string };
        }[];
      }>(
        'playlists',
        { part: 'snippet,contentDetails,status', id: parsed.id, maxResults: '1' },
        apiKey
      );
      const pl = plRes.items?.[0];
      if (!pl || pl.status?.privacyStatus === 'private') {
        return json(404, {
          error: 'This playlist does not exist or is private. Check the link and try again.',
        });
      }

      // playlistItems.list with pagination (50/page, cap 200)
      const items: YtPlaylistItem[] = [];
      let pageToken: string | undefined;
      let truncated = false;
      do {
        const piRes = await ytFetch<{
          nextPageToken?: string;
          items?: {
            id: string;
            snippet?: {
              position?: number;
              title?: string;
              resourceId?: { videoId?: string };
              thumbnails?: Record<string, { url?: string }>;
            };
          }[];
        }>(
          'playlistItems',
          {
            part: 'snippet',
            playlistId: parsed.id,
            maxResults: String(PAGE_SIZE),
            ...(pageToken ? { pageToken } : {}),
          },
          apiKey
        );
        for (const it of piRes.items ?? []) {
          items.push({
            position: it.snippet?.position ?? items.length,
            videoId: it.snippet?.resourceId?.videoId ?? '',
            itemId: it.id,
            title: it.snippet?.title ?? null,
            thumbnail: bestThumb(it.snippet?.thumbnails),
            meta: null,
          });
          if (items.length >= IMPORT_CAP) break;
        }
        pageToken = piRes.nextPageToken;
        if (items.length >= IMPORT_CAP && pageToken) {
          truncated = true;
          break;
        }
      } while (pageToken);
      if (pageToken) truncated = true;

      // batched videos.list for durations/embeddability (50 per call)
      const videoIds = items.map((i) => i.videoId).filter(Boolean);
      const metaMap = new Map<string, YtVideoMeta>();
      for (let i = 0; i < videoIds.length; i += PAGE_SIZE) {
        const chunk = videoIds.slice(i, i + PAGE_SIZE);
        const vRes = await ytFetch<{
          items?: {
            id: string;
            snippet?: { title?: string; channelTitle?: string };
            contentDetails?: { duration?: string };
            status?: { privacyStatus?: string; embeddable?: boolean; uploadStatus?: string };
          }[];
        }>(
          'videos',
          { part: 'snippet,contentDetails,status', id: chunk.join(','), maxResults: String(PAGE_SIZE) },
          apiKey
        );
        for (const v of vRes.items ?? []) {
          metaMap.set(v.id, {
            id: v.id,
            title: v.snippet?.title ?? null,
            channel: v.snippet?.channelTitle ?? null,
            thumbnail: null,
            duration_seconds: v.contentDetails?.duration
              ? parseIsoDuration(v.contentDetails.duration)
              : null,
            embeddable: v.status?.embeddable !== false,
            privacy: (v.status?.privacyStatus ?? 'unknown') as YtVideoMeta['privacy'],
            upload_status: v.status?.uploadStatus ?? null,
          });
        }
      }

      resource = {
        source_type: 'playlist',
        youtube_id: parsed.id,
        source_url: parsed.normalizedUrl,
        title: pl.snippet?.title ?? null,
        channel_name: pl.snippet?.channelTitle ?? null,
        thumbnail_url: bestThumb(pl.snippet?.thumbnails),
        import_state: 'ready',
        metadata: {
          playlist_item_count: pl.contentDetails?.itemCount ?? null,
          items: items.map((i) => {
            const m = metaMap.get(i.videoId) ?? null;
            return {
              position: i.position,
              video_id: i.videoId,
              item_id: i.itemId,
              title: i.title,
              thumbnail: i.thumbnail,
              // The video's own channel — may differ from the playlist owner.
              channel_name: m?.channel ?? null,
              duration_seconds: m?.duration_seconds ?? null,
              embeddable: m?.embeddable ?? false,
              privacy_status: m?.privacy ?? 'unavailable',
              available: Boolean(m) && m!.privacy !== 'private' && m!.upload_status !== 'deleted',
            };
          }),
          truncated,
          imported_count: items.length,
        },
      };
    }

    // A re-import of the same resource must never erase a previously saved
    // study goal, so only overwrite the topic when a new one was supplied.
    const { data: existingRow } = await admin
      .from('user_resources')
      .select('topic')
      .eq('owner_id', userId)
      .eq('source_type', parsed.type)
      .eq('youtube_id', parsed.id)
      .maybeSingle();
    const effectiveTopic = topic ?? existingRow?.topic ?? null;

    // --- Persistence (idempotent per owner+type+id) ---
    const { data: saved, error: saveError } = await admin
      .from('user_resources')
      .upsert(
        {
          owner_id: userId,
          ...resource,
          topic: effectiveTopic,
          is_curated: false,
          metadata_fetched_at: nowIso,
          metadata_expires_at: expiresIso,
        },
        { onConflict: 'owner_id,source_type,youtube_id' }
      )
      .select('id, source_type, youtube_id, title, channel_name, topic, import_state, metadata')
      .single();

    if (saveError || !saved) {
      console.error('resource save failed', saveError?.message);
      return json(500, { error: 'Imported, but saving the lesson failed. Please try again.' });
    }

    await admin.from('import_rate_log').insert({ user_id: userId });

    return json(200, { resource: saved, import_cap: IMPORT_CAP });
  } catch (err) {
    if (err instanceof YtApiError) {
      const safe = [403, 404, 429, 504].includes(err.status);
      return json(safe ? err.status : 502, {
        error: safe ? err.message : 'YouTube could not process this request. Please try again.',
      });
    }
    console.error('youtube-import unexpected error', err instanceof Error ? err.message : err);
    return json(500, { error: 'Unexpected error during import. Please try again.' });
  }
});
