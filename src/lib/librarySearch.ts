import { supabase } from '@/lib/supabase';

export interface DiscoveredVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  embeddable: boolean;
  publishedAt: string | null;
}

/**
 * Search YouTube for lessons via the youtube-search edge function.
 * Results are NOT syllabus-verified — callers must label them "Discovered".
 */
export async function searchYouTubeLessons(query: string): Promise<DiscoveredVideo[]> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-search`;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Your session expired. Please sign in again.');
  }
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ query }),
  });
  const payload = (await res.json().catch(() => null)) as { results?: DiscoveredVideo[]; error?: string } | null;
  if (!res.ok || !payload) {
    throw new Error(payload?.error ?? 'Could not search for lessons. Please try again.');
  }
  return payload.results ?? [];
}

/**
 * Import a YouTube video into the user's library and return the resource id.
 * Reuses the existing youtube-import edge function.
 */
export async function importYouTubeVideo(
  videoId: string,
  topic?: string
): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-import`;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Your session expired. Please sign in again.');
  }
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ url, topic: topic || undefined }),
  });
  const payload = (await res.json().catch(() => null)) as { resource?: { id: string }; error?: string } | null;
  if (!res.ok || !payload?.resource) {
    throw new Error(payload?.error ?? 'Could not import this lesson. Please try again.');
  }
  return payload.resource.id;
}
