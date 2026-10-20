import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
}

interface LibraryPageProps {
  profile: StudentProfile;
}

/**
 * Curriculum library. Relationships: board -> syllabus_version -> class ->
 * subject -> chapter. Subject lists are filtered through that exact chain,
 * so unrelated boards' subjects can never appear (no duplicates, no name
 * dedupe). Where verified content does not exist we say so truthfully and
 * point to Bring Your Own Lesson.
 */
export function LibraryPage({ profile }: LibraryPageProps) {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeBoardId, setActiveBoardId] = useState<string | null>(
    profile.board_id
  );
  const [activeClassId, setActiveClassId] = useState<string | null>(
    profile.class_id
  );
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(
    profile.focused_subject_id
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      const [boardsRes, classesRes, subjectsRes, chaptersRes] =
        await Promise.all([
          supabase.from('boards').select('*').order('name'),
          supabase
            .from('classes')
            .select(
              'id, syllabus_version_id, level, label, qualification, syllabus_versions!inner(board_id, published)'
            )
            .order('level'),
          supabase.from('subjects').select('*').order('display_order'),
          supabase.from('chapters').select('*').order('display_order'),
        ]);

      if (cancelled) return;
      const firstError =
        boardsRes.error ?? classesRes.error ?? subjectsRes.error ?? chaptersRes.error;
      if (firstError) {
        setError('Could not load the curriculum. Please refresh.');
        setLoading(false);
        return;
      }

      setBoards((boardsRes.data ?? []) as Board[]);
      setClasses((classesRes.data ?? []) as ClassRow[]);
      setSubjects((subjectsRes.data ?? []) as Subject[]);
      setChapters((chaptersRes.data ?? []) as Chapter[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Classes whose syllabus version belongs to the selected board AND is
  // published — the same chain the operator marks display-ready.
  const classesForBoard = useMemo(() => {
    if (!activeBoardId) return [];
    const versionIds = new Set(
      classes
        .filter(
          (c: ClassRow & { syllabus_versions?: { board_id: string; published: boolean } }) =>
            c.syllabus_versions?.board_id === activeBoardId &&
            c.syllabus_versions?.published
        )
        .map((c) => c.syllabus_version_id)
    );
    return classes.filter((c) => versionIds.has(c.syllabus_version_id));
  }, [classes, activeBoardId]);

  const subjectsForClass = useMemo(
    () =>
      activeClassId
        ? subjects.filter((s) => s.class_id === activeClassId)
        : [],
    [subjects, activeClassId]
  );

  const activeSubject =
    subjectsForClass.find((s) => s.id === activeSubjectId) ?? null;
  const subjectChapters = chapters.filter(
    (c) => c.subject_id === activeSubject?.id
  );
  const publishedChapters = subjectChapters.filter(
    (c) => c.verification_status === 'published'
  );

  function pickBoard(id: string) {
    setActiveBoardId(id);
    setActiveClassId(null);
    setActiveSubjectId(null);
  }

  function pickClass(id: string) {
    setActiveClassId(id);
    setActiveSubjectId(null);
  }

  const classLabel = (c: ClassRow) =>
    c.qualification
      ? `${c.label} (${c.qualification.toUpperCase()})`
      : c.label;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading library" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-accent">Curated learning paths</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
        Verified chapters and lectures
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
        Optional curated pathways — CBSE, ICSE (Classes 9-10) and ISC
        (Classes 11-12), plus UP Board, Classes 9-12. Only chapters that have
        been checked and verified are marked ready. Not your pathway? You can
        always bring your own lesson instead.
      </p>

      {/* Board switcher */}
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Board">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pickBoard(b.id)}
            aria-pressed={activeBoardId === b.id}
            className={`min-h-touch rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              activeBoardId === b.id
                ? 'border-accent bg-accent-soft text-accent-strong'
                : 'border-line bg-raised text-ink-soft hover:border-line-strong'
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
          {error}
        </p>
      )}

      {/* Grade selector */}
      {activeBoardId && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-ink-soft">Class</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Class">
            {classesForBoard.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickClass(c.id)}
                aria-pressed={activeClassId === c.id}
                className={`min-h-touch rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                  activeClassId === c.id
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-line bg-raised text-ink-soft hover:border-line-strong'
                }`}
              >
                {classLabel(c)}
              </button>
            ))}
            {classesForBoard.length === 0 && (
              <p className="text-sm text-ink-faint">
                No published classes for this board yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* BYOL alternative */}
      {activeBoardId && (
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-5 flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-line-strong bg-raised/60 px-4 py-3 text-left transition-colors hover:border-accent/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            <Link2 className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">Bring your own lesson instead</span>
            {' '}— paste any YouTube video or playlist from the dashboard, no
            board or grade needed.
          </span>
        </button>
      )}

      {/* Subject tabs — only real subjects of the selected class */}
      {subjectsForClass.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Subject">
          {subjectsForClass.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSubjectId(s.id)}
              aria-pressed={activeSubjectId === s.id}
              className={`min-h-touch rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                activeSubjectId === s.id
                  ? 'border-accent bg-accent-soft text-accent-strong'
                  : 'border-line bg-raised text-ink-soft hover:border-line-strong'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Chapter list */}
      {activeSubject ? (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold text-ink">
            {activeSubject.name} chapters
          </h2>

          {publishedChapters.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-raised px-6 py-10 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink">
                Nothing verified here yet
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
                No chapters for {activeSubject.name} have passed verification
                yet — we never list unchecked content as ready. You can still
                learn from your own trusted teachers: bring any YouTube lesson
                into your workspace.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {publishedChapters.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3 shadow-sm"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{c.title}</p>
                    <p className="text-xs text-ink-faint">Chapter {c.display_order}</p>
                  </div>
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong">
                    Verified
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        !activeBoardId && (
          <div className="mt-8 rounded-2xl border border-dashed border-line-strong bg-raised/60 px-6 py-10 text-center">
            <GraduationCap className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
            <p className="mt-3 text-sm font-medium text-ink">
              Pick a pathway above — or skip the curriculum entirely
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">
              Curated paths are optional. Programming, languages, university
              topics — if your teacher teaches it on YouTube, you can study it
              here.
            </p>
          </div>
        )
      )}
    </div>
  );
}
