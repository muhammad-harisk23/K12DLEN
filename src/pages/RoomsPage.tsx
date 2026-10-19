import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2, LogIn, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { fetchMyRooms, createRoomSecure } from '@/lib/rooms';
import type { RoomSummary } from '@/lib/rooms';
import { formatDuration } from '@/lib/youtube';
import { supabase } from '@/lib/supabase';

interface LibraryResource {
  id: string;
  title: string | null;
  topic: string | null;
  channel_name: string | null;
  source_type: 'video' | 'playlist';
  study_sessions: { focus_seconds: number }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Study rooms hub: your existing rooms plus room creation (optionally
 * pre-linked to a saved lesson via ?link=resourceId).
 */
export function RoomsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedParam = searchParams.get('link');
  const linkedId = linkedParam && UUID_RE.test(linkedParam) ? linkedParam : null;

  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryResource[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(Boolean(linkedId));

  const [title, setTitle] = useState('');
  const [mission, setMission] = useState('');
  const [resourceId, setResourceId] = useState<string | null>(linkedId);

  const loadRooms = useCallback(async () => {
    setLoadError(null);
    try {
      setRooms(await fetchMyRooms());
    } catch (err) {
      setRooms([]);
      setLoadError(err instanceof Error ? err.message : 'Could not load rooms.');
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!showCreate) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('user_resources')
        .select(
          'id, title, topic, channel_name, source_type, study_sessions(focus_seconds)'
        )
        .order('created_at', { ascending: false })
        .limit(30);
      if (cancelled) return;
      if (!error) setLibrary((data ?? []) as LibraryResource[]);
      else setLibrary([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [showCreate]);

  useEffect(() => {
    if (!linkedId || !library) return;
    const linked = library.find((r) => r.id === linkedId);
    if (linked && !title.trim()) {
      setTitle((linked.topic?.trim() || linked.title || 'Study room').slice(0, 120));
    }
  }, [linkedId, library, title]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setCreateError('Give the room a clear title.');
      return;
    }
    setCreating(true);
    try {
      const id = await createRoomSecure(cleanTitle, mission.trim(), resourceId);
      navigate(`/rooms/${id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the room.');
      setCreating(false);
    }
  }

  const linkedResource = useMemo(
    () => library?.find((r) => r.id === resourceId) ?? null,
    [library, resourceId]
  );

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-accent">Study together</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
        Private study rooms
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
        Bring a lesson into a calm, private room with a classmate. Everyone
        learns at their own pace — you each control your own video and focus
        timer, while sharing the same academic mission.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant={showCreate ? 'secondary' : 'primary'}
          onClick={() => setShowCreate((s) => !s)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {showCreate ? 'Close' : 'Create a room'}
        </Button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mt-4 space-y-4 rounded-2xl border border-accent/25 bg-raised p-5 shadow-sm sm:p-6"
        >
          <TextField
            label="Room title"
            placeholder="e.g. Quadratic equations study group"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
          <div>
            <label
              htmlFor="mission"
              className="mb-1.5 block text-sm font-medium text-ink"
            >
              Academic study mission
            </label>
            <textarea
              id="mission"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="What will you master together? e.g. Work through factorisation methods and solve 10 practice problems each."
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-ink-faint">
              {mission.length}/280
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              Linked lesson (optional)
            </p>
            {library === null ? (
              <p className="text-sm text-ink-faint">Loading your library…</p>
            ) : library.length === 0 ? (
              <p className="text-sm text-ink-faint">
                No saved lessons yet — you can still create a room and link a
                lesson later.
              </p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setResourceId(null)}
                    aria-pressed={resourceId === null}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      resourceId === null ? 'bg-accent-soft' : 'hover:bg-sunken'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    No linked lesson
                  </button>
                </li>
                {library.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setResourceId(r.id)}
                      aria-pressed={resourceId === r.id}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        resourceId === r.id ? 'bg-accent-soft' : 'hover:bg-sunken'
                      }`}
                    >
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          resourceId === r.id
                            ? 'bg-white text-accent-strong'
                            : 'bg-accent-soft text-accent-strong'
                        }`}
                      >
                        {r.source_type === 'video' ? 'Video' : 'Playlist'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {r.topic?.trim() || r.title || 'Untitled lesson'}
                        </span>
                        {r.channel_name && (
                          <span className="block truncate text-[11px] text-ink-faint">
                            {r.channel_name}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {createError && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
              {createError}
            </p>
          )}

          <Button type="submit" loading={creating}>
            <LogIn className="h-4 w-4" aria-hidden />
            Create private room
          </Button>
          <p className="text-xs leading-relaxed text-ink-faint">
            {linkedResource
              ? `Private by default — only classmates you invite will see this room and its lesson. Your saved progress in ${formatDuration(linkedResource.study_sessions?.[0]?.focus_seconds ?? 0)} stays yours.`
              : 'Private by default — only classmates you invite will see this room.'}
          </p>
        </form>
      )}

      {loadError && (
        <p className="mt-6 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {loadError}
        </p>
      )}

      <section className="mt-8" aria-label="Your study rooms">
        <h2 className="font-display text-base font-bold text-ink">
          Your rooms
        </h2>
        {rooms === null ? (
          <div className="flex min-h-[20vh] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading rooms" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line-strong bg-raised/60 px-6 py-10 text-center">
            <Users className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
            <p className="mt-3 text-sm font-medium text-ink">
              No study rooms yet
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">
              Create a room, share the invitation link with a classmate, and
              study the same lesson together — each at your own pace.
            </p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/rooms/${r.id}`)}
                  className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-raised p-4 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-md"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {r.title}
                    </span>
                    {r.mission.trim() ? (
                      <span className="mt-0.5 block line-clamp-1 text-xs text-ink-soft">
                        {r.mission.trim()}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-ink-faint">
                      {r.memberCount} {r.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
