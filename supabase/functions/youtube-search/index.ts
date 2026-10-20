// youtube-search edge function — lesson discovery via YouTube Data API v3.
//
// POST { query: string }
// Auth: requires a valid Supabase user JWT (verify_jwt = true).
// Calls search.list with the YOUTUBE_API_KEY secret (never returned or
// logged), returns video metadata for embeddable, public results. Does NOT
// persist anything — this is a read-only discovery surface. A discovered
// video is NOT syllabus-verified; the caller must label it "Discovered".
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;
const MAX_QUERY_LEN = 200;

interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  embeddable: boolean;
  publishedAt: string | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    null
  );
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
      return json(401, { error: 'Sign in to search for lessons.' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const apiKey = Deno.env.get('YOUTUBE_API_KEY');
    if (!apiKey) {
      console.error('youtube-search: YOUTUBE_API_KEY secret missing');
      return json(500, { error: 'The YouTube integration is not configured.' });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json(401, { error: 'Sign in to search for lessons.' });
    }

    let body: { query?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Invalid request body.' });
    }

    const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
    if (!rawQuery) {
      return json(400, { error: 'Enter a topic to search for.' });
    }
    if (rawQuery.length > MAX_QUERY_LEN) {
      return json(400, { error: 'Search query is too long.' });
    }

    // search.list — type=video, embeddable=true, relevanceLanguage=en
    const searchUrl = new URL(`${YT_API_BASE}/search`);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(MAX_RESULTS));
    searchUrl.searchParams.set('q', rawQuery);
    searchUrl.searchParams.set('relevanceLanguage', 'en');
    searchUrl.searchParams.set('videoEmbeddable', 'true');
    searchUrl.searchParams.set('videoDuration', 'medium');
    searchUrl.searchParams.set('key', apiKey);

    const searchController = new AbortController();
    const searchTimer = setTimeout(() => searchController.abort(), FETCH_TIMEOUT_MS);
    let searchRes: Response;
    try {
      searchRes = await fetch(searchUrl, {
        signal: searchController.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return json(504, { error: 'The search request timed out. Try again.' });
      }
      return json(502, { error: 'Could not reach the YouTube API.' });
    } finally {
      clearTimeout(searchTimer);
    }

    if (!searchRes.ok) {
      let reason = `YouTube API error ${searchRes.status}`;
      try {
        const errBody = (await searchRes.json()) as {
          error?: { message?: string; errors?: { reason?: string }[] };
        };
        const apiReason = errBody.error?.errors?.[0]?.reason;
        if (searchRes.status === 403 && apiReason === 'quotaExceeded') {
          reason = 'YouTube API quota is exhausted. Try again later.';
        } else if (errBody.error?.message) {
          reason = `YouTube API error: ${errBody.error.message}`;
        }
      } catch {
        // keep generic
      }
      return json(searchRes.status === 403 || searchRes.status === 404 ? searchRes.status : 502, { error: reason });
    }

    const searchData = (await searchRes.json()) as {
      items?: {
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          channelTitle?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
      }[];
    };

    const videoIds = (searchData.items ?? [])
      .map((i) => i.id?.videoId ?? '')
      .filter((id) => /^[\w-]{11}$/.test(id));

    if (videoIds.length === 0) {
      return json(200, { results: [] });
    }

    // videos.list for durations + embeddability
    const videoUrl = new URL(`${YT_API_BASE}/videos`);
    videoUrl.searchParams.set('part', 'contentDetails,status');
    videoUrl.searchParams.set('id', videoIds.join(','));
    videoUrl.searchParams.set('maxResults', String(MAX_RESULTS));
    videoUrl.searchParams.set('key', apiKey);

    const videoController = new AbortController();
    const videoTimer = setTimeout(() => videoController.abort(), FETCH_TIMEOUT_MS);
    let videoRes: Response;
    try {
      videoRes = await fetch(videoUrl, {
        signal: videoController.signal,
        headers: { Accept: 'application/json' },
      });
    } catch {
      // If duration lookup fails, return results without durations
      const fallback: SearchResult[] = (searchData.items ?? []).map((item) => ({
        videoId: item.id?.videoId ?? '',
        title: item.snippet?.title ?? 'Untitled',
        channel: item.snippet?.channelTitle ?? 'Unknown',
        thumbnail: bestThumb(item.snippet?.thumbnails),
        durationSeconds: null,
        embeddable: true,
        publishedAt: item.snippet?.publishedAt ?? null,
      })).filter((r) => r.videoId);
      return json(200, { results: fallback });
    } finally {
      clearTimeout(videoTimer);
    }

    const durationMap = new Map<string, { duration: number | null; embeddable: boolean }>();
    if (videoRes.ok) {
      const videoData = (await videoRes.json()) as {
        items?: {
          id: string;
          contentDetails?: { duration?: string };
          status?: { embeddable?: boolean; privacyStatus?: string };
        }[];
      };
      for (const v of videoData.items ?? []) {
        durationMap.set(v.id, {
          duration: v.contentDetails?.duration ? parseIsoDuration(v.contentDetails.duration) : null,
          embeddable: v.status?.embeddable !== false,
        });
      }
    }

    const results: SearchResult[] = (searchData.items ?? [])
      .map((item) => {
        const videoId = item.id?.videoId ?? '';
        if (!videoId) return null;
        const meta = durationMap.get(videoId);
        return {
          videoId,
          title: item.snippet?.title ?? 'Untitled',
          channel: item.snippet?.channelTitle ?? 'Unknown',
          thumbnail: bestThumb(item.snippet?.thumbnails),
          durationSeconds: meta?.duration ?? null,
          embeddable: meta?.embeddable ?? true,
          publishedAt: item.snippet?.publishedAt ?? null,
        };
      })
      .filter((r): r is SearchResult => r !== null && r.embeddable);

    return json(200, { results });
  } catch (err) {
    console.error('youtube-search unexpected error', err instanceof Error ? err.message : err);
    return json(500, { error: 'Unexpected error during search. Please try again.' });
  }
});
