import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase';
import { useAsyncError } from '@/hooks/useAsyncError';
import type {
  Board,
  ClassRow,
  StudentProfile,
  Subject,
} from '@/types/curriculum';

interface OnboardingProps {
  profile: StudentProfile;
  boards: Board[];
  classes: ClassRow[];
  subjects: Subject[];
  ready: boolean;
  onDone: (updated: StudentProfile) => void;
}

type PathChoice = 'curated' | 'own';

/**
 * Onboarding. Two paths of equal dignity:
 *  - Curated: board -> class (9-12, ICSE/ISC qualified where applicable)
 *    -> focus subject. Only published versions with real subjects shown.
 *  - Own path: no board/class/subject — bring your own YouTube lessons.
 * Curriculum is optional by design; nothing blocks a worldwide learner.
 */
export function OnboardingFlow({
  profile,
  boards,
  classes,
  subjects,
  ready,
  onDone,
}: OnboardingProps) {
  const { error, setError, capture } = useAsyncError();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [path, setPath] = useState<PathChoice | null>(
    profile.board_id ? 'curated' : null
  );

  const [displayName, setDisplayName] = useState(profile.display_name);
  const [boardId, setBoardId] = useState<string | null>(profile.board_id);
  const [classId, setClassId] = useState<string | null>(profile.class_id);
  const [subjectId, setSubjectId] = useState<string | null>(
    profile.focused_subject_id
  );

  const classesForBoard = useMemo(() => {
    if (!boardId) return [];
    const versionIds = new Set(
      classes
        .filter(
          (c) =>
            c.syllabus_versions.board_id === boardId &&
            c.syllabus_versions.published
        )
        .map((c) => c.syllabus_version_id)
    );
    return classes.filter((c) => versionIds.has(c.syllabus_version_id));
  }, [classes, boardId]);

  const selectedClass = classes.find((c) => c.id === classId) ?? null;
  const subjectsForClass = subjects.filter(
    (s) => s.class_id === classId
  );

  function pickBoard(id: string) {
    setBoardId(id);
    setClassId(null);
    setSubjectId(null);
  }

  function pickClass(id: string) {
    setClassId(id);
    setSubjectId(null);
  }

  function pickPath(choice: PathChoice) {
    setPath(choice);
    if (choice === 'own') {
      setBoardId(null);
      setClassId(null);
      setSubjectId(null);
    }
  }

  async function finish() {
    setSaving(true);
    setError(null);

    const curated = path === 'curated';
    const { data, error: updateError } = await supabase
      .from('student_profiles')
      .update({
        display_name: displayName.trim().slice(0, 40) || profile.display_name,
        board_id: curated ? boardId : null,
        class_id: curated ? classId : null,
        focused_subject_id: curated ? subjectId : null,
        onboarded_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
      .select('*')
      .single();

    setSaving(false);
    if (updateError || !data) {
      capture(updateError ?? new Error('Could not save your preferences.'));
      return;
    }
    onDone(data as StudentProfile);
  }

  const classLabel = (c: ClassRow) =>
    c.qualification ? `${c.label} (${c.qualification.toUpperCase()})` : c.label;

  const canContinue =
    step === 0
      ? displayName.trim().length > 0
      : step === 1
        ? path === 'own'
          ? true
          : Boolean(boardId && classId)
        : path === 'own'
          ? true
          : Boolean(subjectId);

  // The curated path is available when curriculum loaded; the own path is
  // always available, even if the curriculum fetch failed entirely.
  const curriculumMissing =
    ready && (boards.length === 0 || classes.length === 0);

  async function skipOnboarding() {
    setSaving(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from('student_profiles')
        .update({
          display_name: displayName.trim().slice(0, 40) || profile.display_name,
          onboarded_at: new Date().toISOString(),
        })
        .eq('id', profile.id)
        .select('*')
        .single();
      if (updateError || !data) {
        capture(updateError ?? new Error('Could not save your preferences.'));
        return;
      }
      onDone(data as StudentProfile);
    } catch {
      capture(new Error('Could not save your preferences.'));
    } finally {
      setSaving(false);
    }
  }

  function goNext() {
    if (step === 1 && path === 'own') {
      void finish();
      return;
    }
    setStep(step + 1);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-lg animate-fade-up">
        {/* Progress */}
        <div className="mb-8 flex items-center gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-accent' : 'bg-line'
              }`}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-line bg-raised p-6 shadow-sm sm:p-8">
          {step === 0 && (
            <section aria-label="Your name">
              <h1 className="font-display text-xl font-bold text-ink">
                What should we call you?
              </h1>
              <p className="mt-1.5 text-sm text-ink-soft">
                Just a first name is perfect. This is what study partners see.
              </p>
              <div className="mt-6">
                <TextField
                  label="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={40}
                  autoFocus
                />
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-label="How do you want to learn?">
              <h1 className="font-display text-xl font-bold text-ink">
                How do you want to learn?
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                Follow a curated curriculum, or skip it entirely and learn
                from your own YouTube teachers. Both are first-class here.
              </p>

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={() => pickPath('curated')}
                  aria-pressed={path === 'curated'}
                  disabled={curriculumMissing}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    path === 'curated'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-raised hover:border-line-strong'
                  }`}
                >
                  <span className="text-sm font-semibold text-ink">
                    Follow a curated curriculum
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
                    {curriculumMissing
                      ? 'Curated pathways are loading or unavailable right now.'
                      : 'Classes 9-12 for CBSE, ICSE (9-10) and ISC (11-12), and UP Board — with verified content marked honestly.'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => pickPath('own')}
                  aria-pressed={path === 'own'}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                    path === 'own'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-raised hover:border-line-strong'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Globe2 className="h-4 w-4 text-accent" aria-hidden />
                    Bring my own lessons (no curriculum needed)
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
                    Programming, languages, university topics, school support
                    anywhere in the world — paste YouTube lessons from any
                    teacher and study them with focus.
                  </span>
                </button>
              </div>

              {path === 'curated' && (
                <>
                  <fieldset className="mt-6">
                    <legend className="mb-2 text-sm font-medium text-ink-soft">
                      Board
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {boards.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => pickBoard(b.id)}
                          aria-pressed={boardId === b.id}
                          className={`min-h-touch rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                            boardId === b.id
                              ? 'border-accent bg-accent-soft text-accent-strong'
                              : 'border-line bg-raised text-ink-soft hover:border-line-strong'
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-5">
                    <legend className="mb-2 text-sm font-medium text-ink-soft">
                      Class
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {classesForBoard.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickClass(c.id)}
                          aria-pressed={classId === c.id}
                          className={`min-h-touch rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                            classId === c.id
                              ? 'border-accent bg-accent-soft text-accent-strong'
                              : 'border-line bg-raised text-ink-soft hover:border-line-strong'
                          }`}
                        >
                          {classLabel(c)}
                        </button>
                      ))}
                      {boardId && classesForBoard.length === 0 && (
                        <p className="text-sm text-ink-faint">
                          No published classes for this board yet — you can
                          still bring your own lessons.
                        </p>
                      )}
                      {!boardId && (
                        <p className="text-sm text-ink-faint">
                          Pick a board first.
                        </p>
                      )}
                    </div>
                  </fieldset>
                </>
              )}
            </section>
          )}

          {step === 2 && path === 'curated' && (
            <section aria-label="Subject">
              <h1 className="font-display text-xl font-bold text-ink">
                Pick a subject to focus on
              </h1>
              <p className="mt-1.5 text-sm text-ink-soft">
                You can switch any time. This just personalizes your dashboard.
              </p>
              <div className="mt-6 space-y-2">
                {subjectsForClass.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubjectId(s.id)}
                    aria-pressed={subjectId === s.id}
                    className={`flex min-h-touch w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      subjectId === s.id
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-line bg-raised text-ink hover:border-line-strong'
                    }`}
                  >
                    <span>{s.name}</span>
                    {subjectId === s.id && <Check className="h-4 w-4" aria-hidden />}
                  </button>
                ))}
                {subjectsForClass.length === 0 && (
                  <div className="rounded-xl bg-sunken px-4 py-3 text-sm leading-relaxed text-ink-soft">
                    No verified subjects exist for {selectedClass?.label ?? 'this class'} yet —
                    we never pretend unchecked content is ready. Your saved
                    pathway will fill in as content is verified. You can also
                    learn from your own teachers right now by bringing your
                    own lessons on the dashboard.
                  </div>
                )}
              </div>
            </section>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
              {error}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() =>
                step === 0 ? void skipOnboarding() : setStep(step - 1)
              }
              disabled={saving}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {step === 0 ? 'Skip for now' : 'Back'}
            </Button>
            {step < 2 ? (
              <Button onClick={goNext} disabled={!canContinue}>
                {step === 1 && path === 'own' ? (
                  <>
                    Start studying
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={finish} loading={saving} disabled={!canContinue}>
                Start studying
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
