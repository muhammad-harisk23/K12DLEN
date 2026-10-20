import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock,
  ExternalLink,
  GraduationCap,
  Link2,
  Loader2,
  Play,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { searchYouTubeLessons, importYouTubeVideo } from '@/lib/librarySearch';
import type { DiscoveredVideo } from '@/lib/librarySearch';
import { formatDuration } from '@/lib/youtube';
import type {
  Board,
  Chapter,
  StudentProfile,
  Subject,
} from '@/types/curriculum';

interface ClassRow {
  id: string;
  syllabus_version_id: string;
  level: number;
  label: string;
  qualification: string | null;
  syllabus_versions: { board_id: string; published: boolean }[];
}

interface LibraryPageProps {
  profile: StudentProfile;
}

type Step = 'board' | 'class' | 'subject' | 'chapter' | 'lessons';

interface Crumb {
  step: Step;
  label: string;
}

export function LibraryPage({ profile }: LibraryPageProps) {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeBoardId, setActiveBoardId] = useState<string | null>(profile.board_id);
  const [activeClassId, setActiveClassId] = useState<string | null>(profile.class_id);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(profile.focused_subject_id);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);

  const [videos, setVideos] = useState<DiscoveredVideo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const step: Step = activeChapter
    ? 'lessons'
    : activeSubjectId
      ? 'chapter'
      : activeClassId
        ? 'subject'
        : activeBoardId
          ? 'class'
          : 'board';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const [boardsRes, classesRes, subjectsRes, chaptersRes] = await Promise.all([
        supabase.from('boards').select('*').order('name'),
        supabase
          .from('classes')
          .select('id, syllabus_version_id, level, label, qualification, syllabus_versions!inner(board_id, published)')
          .order('level'),
        supabase.from('subjects').select('*').order('display_order'),
        supabase.from('chapters').select('*').order('display_order'),
      ]);
      if (cancelled) return;
      const firstError = boardsRes.error ?? classesRes.error ?? subjectsRes.error ?? chaptersRes.error;
      if (firstError) {
        setLoadError('Could not load the curriculum. Please refresh.');
        setLoading(false);
        return;
      }
      setBoards((boardsRes.data ?? []) as Board[]);
      setClasses((classesRes.data ?? []) as ClassRow[]);
      setSubjects((subjectsRes.data ?? []) as Subject[]);
      setChapters((chaptersRes.data ?? []) as Chapter[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const classesForBoard = useMemo(() => {
    if (!activeBoardId) return [];
    const versionIds = new Set(
      classes
        .filter((c) => c.syllabus_versions?.[0]?.board_id === activeBoardId && c.syllabus_versions?.[0]?.published)
        .map((c) => c.syllabus_version_id)
    );
    return classes.filter((c) => versionIds.has(c.syllabus_version_id));
  }, [classes, activeBoardId]);

  const subjectsForClass = useMemo(
    () => (activeClassId ? subjects.filter((s) => s.class_id === activeClassId) : []),
    [subjects, activeClassId]
  );

  const activeSubject = subjectsForClass.find((s) => s.id === activeSubjectId) ?? null;
  const subjectChapters = useMemo(
    () => chapters.filter((c) => c.subject_id === activeSubject?.id),
    [chapters, activeSubject]
  );
  const publishedChapters = subjectChapters.filter((c) => c.verification_status === 'published');

  const crumbs: Crumb[] = useMemo(() => {
    const list: Crumb[] = [{ step: 'board', label: 'Boards' }];
    const board = boards.find((b) => b.id === activeBoardId);
    if (board) {
      list.push({ step: 'class', label: board.name });
      const cls = classesForBoard.find((c) => c.id === activeClassId);
      if (cls) {
        list.push({ step: 'subject', label: cls.qualification ? `${cls.label} (${cls.qualification.toUpperCase()})` : cls.label });
        const subj = subjectsForClass.find((s) => s.id === activeSubjectId);
        if (subj) {
          list.push({ step: 'chapter', label: subj.name });
          if (activeChapter) {
            list.push({ step: 'lessons', label: activeChapter.title });
          }
        }
      }
    }
    return list;
  }, [boards, activeBoardId, classesForBoard, activeClassId, subjectsForClass, activeSubjectId, activeChapter]);

  function navigateToStep(target: Step) {
    if (target === 'board') {
      setActiveBoardId(null);
      setActiveClassId(null);
      setActiveSubjectId(null);
      setActiveChapter(null);
    } else if (target === 'class') {
      setActiveClassId(null);
      setActiveSubjectId(null);
      setActiveChapter(null);
    } else if (target === 'subject') {
      setActiveSubjectId(null);
      setActiveChapter(null);
    } else if (target === 'chapter') {
      setActiveChapter(null);
    }
    setVideos(null);
    setSearchError(null);
  }

  function pickBoard(id: string) {
    setActiveBoardId(id);
    setActiveClassId(null);
    setActiveSubjectId(null);
    setActiveChapter(null);
    setVideos(null);
  }

  function pickClass(id: string) {
    setActiveClassId(id);
    setActiveSubjectId(null);
    setActiveChapter(null);
    setVideos(null);
  }

  function pickSubject(id: string) {
    setActiveSubjectId(id);
    setActiveChapter(null);
    setVideos(null);
  }

  function pickChapter(ch: Chapter) {
    setActiveChapter(ch);
    setVideos(null);
    setSearchError(null);
  }

  const searchQuery = useMemo(() => {
    if (!activeChapter || !activeSubject) return '';
    const board = boards.find((b) => b.id === activeBoardId);
    const cls = classesForBoard.find((c) => c.id === activeClassId);
    const parts = [
      activeChapter.title,
      activeSubject.name,
      cls?.label,
      board?.name,
    ].filter(Boolean);
    return parts.join(' ');
  }, [activeChapter, activeSubject, activeBoardId, boards, classesForBoard, activeClassId]);

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchYouTubeLessons(searchQuery);
      setVideos(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not search for lessons.');
      setVideos([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (step === 'lessons' && !videos && !searching && !searchError) {
      void runSearch();
    }
  }, [step, videos, searching, searchError, runSearch]);

  async function handleWatchInWorkspace(video: DiscoveredVideo) {
    setImportingId(video.videoId);
    setImportError(null);
    try {
      const resourceId = await importYouTubeVideo(video.videoId, activeChapter?.title ?? activeSubject?.name ?? undefined);
      navigate(`/study/${resourceId}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not open this lesson. Please try again.');
    } finally {
      setImportingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading library" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up mx-auto max-w-4xl">
      {/* Header */}
      <div>
        <p className="text-sm font-medium text-accent-strong">Library</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
          Find your next lesson
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
          Choose your board and class, or learn from your own YouTube teachers.
        </p>
      </div>

      {loadError && (
        <p className="mt-6 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
          {loadError}
        </p>
      )}

      {/* Breadcrumb navigation */}
      {crumbs.length > 1 && (
        <nav className="mt-5 flex flex-wrap items-center gap-1 text-xs" aria-label="Library navigation">
          {crumbs.map((c, i) => (
            <span key={c.step} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-ink-faint" aria-hidden />}
              <button
                type="button"
                onClick={() => navigateToStep(c.step)}
                className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                  i === crumbs.length - 1
                    ? 'text-ink'
                    : 'text-ink-soft hover:bg-sunken hover:text-ink'
                }`}
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* Back button — contextual */}
      {step !== 'board' && (
        <button
          type="button"
          onClick={() => {
            const order: Step[] = ['board', 'class', 'subject', 'chapter', 'lessons'];
            const idx = order.indexOf(step);
            if (idx > 0) navigateToStep(order[idx - 1]);
          }}
          className="mt-4 flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
      )}

      {/* ===== Step: Board selection ===== */}
      {step === 'board' && (
        <section className="mt-6 animate-fade-in">
          <p className="mb-3 text-sm font-medium text-ink-soft">Choose your school board</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => pickBoard(b.id)}
                className="group flex items-center gap-3 rounded-2xl border border-line bg-raised p-4 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-card"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                  <GraduationCap className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{b.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint">Curated pathways</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            ))}
          </div>

          {/* BYOL alternative */}
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-raised/60 p-4 text-left transition-colors hover:border-accent/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
              <Link2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Bring your own lesson</span>
              <span className="mt-0.5 block text-xs text-ink-soft">Paste any YouTube link — no board or class needed.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </button>
        </section>
      )}

      {/* ===== Step: Class selection ===== */}
      {step === 'class' && (
        <section className="mt-6 animate-fade-in">
          <p className="mb-3 text-sm font-medium text-ink-soft">Choose your class</p>
          {classesForBoard.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {classesForBoard.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickClass(c.id)}
                  className="group flex min-h-touch items-center gap-2 rounded-xl border border-line bg-raised px-5 py-3 text-sm font-medium text-ink-soft shadow-sm transition-all hover:border-accent/40 hover:text-ink"
                >
                  {c.qualification ? `${c.label} (${c.qualification.toUpperCase()})` : c.label}
                  <ChevronRight className="h-3.5 w-3.5 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">No published classes yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-soft">
                Curriculum for this board is being prepared. You can still bring your own YouTube lessons.
              </p>
              <Button variant="secondary" className="mt-4" onClick={() => navigate('/dashboard')}>
                <Link2 className="h-4 w-4" aria-hidden />
                Bring your own lesson
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ===== Step: Subject selection ===== */}
      {step === 'subject' && (
        <section className="mt-6 animate-fade-in">
          <p className="mb-3 text-sm font-medium text-ink-soft">Choose a subject</p>
          {subjectsForClass.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subjectsForClass.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSubject(s.id)}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-raised p-4 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-card"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink">
                    <BookOpen className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{s.name}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">No subjects available for this class yet</p>
              <Button variant="secondary" className="mt-4" onClick={() => navigate('/dashboard')}>
                <Link2 className="h-4 w-4" aria-hidden />
                Bring your own lesson
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ===== Step: Chapter selection ===== */}
      {step === 'chapter' && activeSubject && (
        <section className="mt-6 animate-fade-in">
          <h2 className="font-display text-lg font-bold text-ink">{activeSubject.name} chapters</h2>
          {publishedChapters.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {publishedChapters.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickChapter(c)}
                    className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-raised p-4 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-card"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-bold text-accent-strong tabular-nums">
                      {c.display_order}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{c.title}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-faint">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        Verified chapter
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink">Nothing verified here yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
                No chapters for {activeSubject.name} have passed verification yet. You can still discover YouTube lessons on this topic below.
              </p>
              <Button variant="secondary" className="mt-4" onClick={() => {
                setActiveChapter({ id: 'search', subject_id: activeSubject.id, code: 'search', title: activeSubject.name, display_order: 0, verification_status: 'published' });
              }}>
                <Search className="h-4 w-4" aria-hidden />
                Discover {activeSubject.name} lessons
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ===== Step: Lesson discovery ===== */}
      {step === 'lessons' && activeChapter && activeSubject && (
        <section className="mt-6 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-ink">{activeChapter.title}</h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                {activeSubject.name} · Discovered on YouTube
              </p>
            </div>
            <Button variant="ghost" onClick={() => void runSearch()} loading={searching} className="!px-3 !py-1.5 text-xs">
              <Search className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </div>

          {/* Source distinction banner */}
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-sunken/60 px-3.5 py-2.5 text-xs leading-relaxed text-ink-soft">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
            <span>
              These are real YouTube results for your topic. They are not syllabus-verified —
              check the teacher and content before relying on them.
            </span>
          </div>

          {searchError && (
            <p className="mt-4 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
              {searchError}
            </p>
          )}

          {importError && (
            <p className="mt-4 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
              {importError}
            </p>
          )}

          {/* Search results */}
          {searching && !videos ? (
            <div className="mt-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4 rounded-2xl border border-line bg-raised p-4">
                  <div className="h-20 w-32 shrink-0 animate-pulse rounded-xl bg-sunken" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-sunken" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
                    <div className="h-3 w-1/4 animate-pulse rounded bg-sunken" />
                  </div>
                </div>
              ))}
            </div>
          ) : videos && videos.length > 0 ? (
            <ul className="mt-5 space-y-3">
              {videos.map((v) => (
                <li key={v.videoId}>
                  <div className="group flex flex-col gap-4 rounded-2xl border border-line bg-raised p-4 shadow-sm transition-all hover:border-accent/30 hover:shadow-card sm:flex-row">
                    {/* Thumbnail */}
                    <div className="relative shrink-0 overflow-hidden rounded-xl bg-ink sm:w-44" style={{ aspectRatio: '16 / 9' }}>
                      {v.thumbnail ? (
                        <img
                          src={v.thumbnail}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Play className="h-6 w-6 text-white/40" aria-hidden />
                        </div>
                      )}
                      {v.durationSeconds != null && v.durationSeconds > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                          {formatDuration(v.durationSeconds)}
                        </span>
                      )}
                    </div>

                    {/* Info + actions */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{v.title}</p>
                      <p className="mt-1 truncate text-xs text-ink-soft">{v.channel}</p>
                      {v.publishedAt && (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {new Date(v.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                        <Button
                          variant="primary"
                          onClick={() => void handleWatchInWorkspace(v)}
                          loading={importingId === v.videoId}
                          disabled={importingId !== null}
                          className="!px-4 !py-2 text-xs"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden />
                          Watch in workspace
                        </Button>
                        <a
                          href={`https://www.youtube.com/watch?v=${v.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-touch items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          YouTube
                        </a>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : videos && videos.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
              <Search className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink">No videos found</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
                YouTube did not return embeddable results for this topic. Try a different chapter, or bring your own lesson.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => void runSearch()}>
                  <Search className="h-4 w-4" aria-hidden />
                  Search again
                </Button>
                <Button variant="ghost" onClick={() => navigate('/dashboard')}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Bring your own lesson
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
