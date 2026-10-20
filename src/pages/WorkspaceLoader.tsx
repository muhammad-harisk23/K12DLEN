import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { supabase } from '@/lib/supabase';
import { parseYouTubeUrl } from '@/lib/youtube';
import type { StudentProfile } from '@/types/curriculum';

interface WorkspaceLoaderProps {
  profile: StudentProfile;
  resourceId: string;
}

export interface PlaylistItemMeta {
  position: number;
  video_id: string;
  title: string | null;
  available: boolean;
  /** YouTube's own embeddable flag — false means the owner forbids off-site playback. */
  embeddable: boolean;
  duration_seconds: number | null;
}

interface LoadedResource {
  parsedType: 'video' | 'playlist';
  youtubeId: string;
  title: string | null;
  channel: string | null;
  topic: string | null;
  /** Single-video embeddability from YouTube (null = unknown). */
  embeddable: boolean | null;
  playlistItems: PlaylistItemMeta[] | null;
  playlistTruncated: boolean;
  focusSeconds: number;
  positionSeconds: number;
  positionVideoId: string | null;
}

/**
 * Route wrapper: verifies the stored resource belongs to the signed-in
 * learner (RLS enforces this too), rebuilds the canonical player target from
 * stored fields, and loads saved session progress before mounting.
 */
export function WorkspaceLoader({ profile, resourceId }: WorkspaceLoaderProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'ready'; data: LoadedResource }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('user_resources')
        .select('source_type, youtube_id, source_url, title, channel_name, topic, metadata, import_state')
        .eq('id', resourceId)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        setState({ status: 'missing' });
        return;
      }

      const candidate =
        data.source_url ??
        (data.source_type === 'video'
          ? `https://www.youtube.com/watch?v=${data.youtube_id}`
          : `https://www.youtube.com/playlist?list=${data.youtube_id}`);
      const result = parseYouTubeUrl(candidate);
      if (!result.ok || result.parsed.id !== data.youtube_id) {
        setState({ status: 'missing' });
        return;
      }

      const { data: session } = await supabase
        .from('study_sessions')
        .select('focus_seconds, last_position_seconds, last_video_id')
        .eq('resource_id', resourceId)
        .maybeSingle();

      const meta = (data.metadata ?? {}) as {
        items?: {
          position: number;
          video_id: string;
          title: string | null;
          available: boolean;
          embeddable?: boolean;
          duration_seconds: number | null;
        }[];
        truncated?: boolean;
        embeddable?: boolean;
      };
      const playlistItems =
        data.source_type === 'playlist' && Array.isArray(meta.items) && meta.items.length > 0
          ? meta.items.map((i) => ({
              position: i.position,
              video_id: i.video_id,
              title: i.title,
              available: i.available !== false,
              embeddable: i.embeddable !== false,
              duration_seconds: i.duration_seconds ?? null,
            }))
          : null;

      if (cancelled) return;
      setState({
        status: 'ready',
        data: {
          parsedType: data.source_type,
          youtubeId: data.youtube_id,
          title: data.title,
          channel: data.channel_name,
          topic: data.topic,
          embeddable:
            data.source_type === 'video' && typeof meta.embeddable === 'boolean'
              ? meta.embeddable
              : null,
          playlistItems,
          playlistTruncated: Boolean(meta.truncated),
          focusSeconds: session?.focus_seconds ?? 0,
          positionSeconds: Number(session?.last_position_seconds ?? 0),
          positionVideoId: (session?.last_video_id as string | null) ?? null,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    void supabase
      .from('user_resources')
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', resourceId);
  }, [state.status, resourceId]);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading workspace" />
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
        <h1 className="font-display text-lg font-bold text-ink">
          Lesson not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          This lesson is not in your library. It may have been removed, or the
          link may belong to another account.
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-5 min-h-touch rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-colors hover:bg-accent-strong"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <WorkspacePage
      profile={profile}
      resourceId={resourceId}
      parsedType={state.data.parsedType}
      youtubeId={state.data.youtubeId}
      title={state.data.title}
      channel={state.data.channel}
      topic={state.data.topic}
      embeddable={state.data.embeddable}
      playlistItems={state.data.playlistItems}
      playlistTruncated={state.data.playlistTruncated}
      initialFocusSeconds={state.data.focusSeconds}
      initialPositionSeconds={state.data.positionSeconds}
      initialPositionVideoId={state.data.positionVideoId}
    />
  );
}
