import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Flame,
  History,
  Library,
  Link2,
  Lock,
  PencilLine,
  Play,
  Target,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { WeeklyConsistency } from '@/components/ui/WeeklyConsistency';
import { DailyGoalEditor } from '@/components/ui/DailyGoalEditor';
import { BadgeArtwork } from '@/components/practice/BadgeArtwork';
import { supabase } from '@/lib/supabase';
import { formatDuration, parseYouTubeUrl } from '@/lib/youtube';
import { fetchProgressOverview, saveDailyGoal } from '@/lib/progress';
import type { ProgressOverview } from '@/lib/progress';
import { fetchAchievements } from '@/lib/achievements';
import type { AchievementSummary } from '@/lib/achievements';
import type { StudentProfile, Subject } from '@/types/curriculum';

interface DashboardProps {
  profile: StudentProfile;
  subjects: Subject[];
  /** Kept for profile-sync parity with other pages; unused in this view. */
  onProfileChange?: (p: StudentProfile) => void;
}

interface ImportedResource {
  id: string;
  source_type: 'video' | 'playlist';
  youtube_id: string;
  title: string | null;
  channel_name: string | null;
  topic: string | null;
  import_state: string;
  metadata: Record<string, unknown>;
}

interface ResourceRow {
  id: string;
  source_type: 'video' | 'playlist';
  youtube_id: string;
  title: string | null;
  channel_name: string | null;
  topic: string | null;
  created_at: string;
  last_opened_at: string | null;
  study_sessions: { focus_seconds: number; last_position_seconds: number }[];
}

function skeletonArray(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

export function DashboardPage({ profile, subjects }: DashboardProps) {
  const navigate = useNavigate();
  const [urlInput, setUrlInput] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const urlCheck = useMemo(() => {
    if (!urlInput.trim()) return { valid: false, reason: null as string | null };
    const result = parseYouTubeUrl(urlInput);
    return result.ok
      ? { valid: true, reason: null as string | null }
      : { valid: false, reason: result.reason };
  }, [urlInput]);
  const urlInvalid = touched && !urlCheck.valid && Boolean(urlInput.trim());

  const [resources, setResources] = useState<ResourceRow[] | null>(null);
  const [focusTotals, setFocusTotals] = useState<{ seconds: number; sessions: number } | null>(null);
  const [progress, setProgress] = useState<ProgressOverview | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [goalSaving, setGoalSaving] = useState(false);
  const [achievements, setAchievements] = useState<AchievementSummary | null>(null);

  const loadProgress = useCallback(async () => {
    setProgressLoading(true);
    try {
      setProgress(await fetchProgressOverview());
    } catch {
      setProgress(null);
    } finally {
      setProgressLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const loadAchievements = useCallback(async () => {
    try {
      setAchievements(await fetchAchievements());
    } catch {
      setAchievements(null);
    }
  }, []);

  useEffect(() => {
    void loadAchievements();
  }, [loadAchievements]);

  const focusedSubject = subjects.find((s) => s.id === profile.focused_subject_id);

  const loadResources = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_resources')
      .select(
        'id, source_type, youtube_id, title, channel_name, topic, created_at, last_opened_at, study_sessions(focus_seconds, last_position_seconds)'
      )
      .order('created_at', { ascending: false })
      .limit(8);
    if (!error && data) {
      setResources(data as ResourceRow[]);
      const totals = (data as ResourceRow[]).reduce(
        (acc, r) => {
          const session = r.study_sessions?.[0];
          if (session) {
            acc.seconds += session.focus_seconds;
          }
          return acc;
        },
        { seconds: 0, sessions: 0 }
      );
      totals.sessions = totals.seconds > 0 ? 1 : 0;
      setFocusTotals(totals.seconds > 0 ? totals : null);
    } else {
      setResources([]);
    }
  }, []);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setImportError(null);

    const rawUrl = urlInput.trim();
    if (!rawUrl) {
      setImportError('Paste a YouTube link to import.');
      return;
    }
    const parsed = parseYouTubeUrl(rawUrl);
    if (!parsed.ok) {
      setImportError(parsed.reason);
      return;
    }

    setImporting(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-import`;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setImportError('Your session expired. Please sign in again.');
        return;
      }
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          url: rawUrl,
          topic: topicInput.trim() || undefined,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { resource?: ImportedResource; error?: string } | null;
      if (!res.ok || !payload?.resource) {
        setImportError(payload?.error ?? 'Could not import this lesson. Please try again.');
        return;
      }
      setUrlInput('');
      setTopicInput('');
      void supabase
        .from('user_resources')
        .update({ last_opened_at: new Date().toISOString() })
        .eq('id', payload.resource.id);
      navigate(`/study/${payload.resource.id}`);
    } catch {
      setImportError('Could not reach the import service. Check your connection and try again.');
    } finally {
      setImporting(false);
    }
  }

  async function handleRemove(resourceId: string) {
    setResources((rs) => rs?.filter((r) => r.id !== resourceId) ?? null);
    await supabase.from('user_resources').delete().eq('id', resourceId);
  }

  async function handleSaveGoal(goal: number) {
    setGoalSaving(true);
    try {
      const tz = progress?.goal.timezone ?? 'Asia/Kolkata';
      await saveDailyGoal(goal, tz);
      await loadProgress();
    } catch {
      // surface silently; the editor stays usable
    } finally {
      setGoalSaving(false);
    }
  }

  const needsOnboarding = !profile.onboarded_at;
  const hasResources = (resources?.length ?? 0) > 0;
  const activeMission = progress?.practice.activeMission ?? null;
  const todayGoal = progress?.goal.questionsGoal ?? 5;
  const todayAnswered = progress?.today.gradedAnswers ?? 0;
  const todayCorrect = progress?.today.correctAnswers ?? 0;
  const todayMet = progress?.today.goalMet ?? false;
  const ringValue = todayGoal > 0 ? Math.min(1, todayAnswered / todayGoal) : 0;

  return (
    <div className="animate-fade-up">
      {needsOnboarding && (
        <button
          onClick={() => navigate('/library')}
          className="mb-6 w-full rounded-2xl border border-accent/30 bg-accent-soft/50 px-4 py-3 text-left text-sm text-accent-strong transition-colors hover:bg-accent-soft"
        >
          Optional: pick a curriculum pathway in the library — or just bring your own lesson below.
        </button>
      )}

      <section className="mb-7">
        <p className="text-sm font-medium text-accent">Your progress</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
          Hi, {profile.display_name}. Let&apos;s make today count.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
          Real practice, real results. Every question you answer is graded
          honestly and counted toward your daily commitment.
        </p>
      </section>

      {/* ===== 1. HERO: today's mission + daily commitment ring ===== */}
      <section
        aria-label="Today's progress"
        className="overflow-hidden rounded-3xl border border-line bg-raised shadow-sm"
      >
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            {activeMission ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                  Continue your mission
                </p>
                <h2 className="mt-2 font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
                  {activeMission.missionText}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                  {todayMet
                    ? "You've hit your daily commitment. Keep going to lock it in."
                    : `Answer ${Math.max(0, todayGoal - todayAnswered)} more question${Math.max(0, todayGoal - todayAnswered) === 1 ? '' : 's'} today to meet your commitment.`}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button onClick={() => navigate(`/practice/${activeMission.topicSlug}`)}>
                    <Play className="h-4 w-4" aria-hidden />
                    Continue learning
                  </Button>
                  {activeMission.resourceId && (
                    <Button variant="secondary" onClick={() => navigate(`/study/${activeMission.resourceId}`)}>
                      <Link2 className="h-4 w-4" aria-hidden />
                      Open lesson
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                  Start a mission
                </p>
                <h2 className="mt-2 font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
                  Pick a topic and set a learning goal.
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                  A mission turns practice into progress. Answer {todayGoal} questions a day to keep your streak alive.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button onClick={() => navigate('/practice')}>
                    <PencilLine className="h-4 w-4" aria-hidden />
                    Start practicing
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/library')}>
                    <Library className="h-4 w-4" aria-hidden />
                    Browse topics
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-sunken/50 p-5 lg:p-6">
            {progressLoading ? (
              <div className="h-[132px] w-[132px] animate-pulse rounded-full bg-sunken" aria-hidden />
            ) : (
              <ProgressRing
                value={ringValue}
                accessibleLabel={`Daily commitment: ${todayAnswered} of ${todayGoal} questions answered today${todayMet ? '. Goal met.' : ''}`}
              >
                <span className="font-display text-2xl font-bold text-ink tabular-nums">{todayAnswered}</span>
                <span className="text-xs text-ink-soft">of {todayGoal}</span>
              </ProgressRing>
            )}
            <div className="flex items-center gap-2 text-xs">
              {todayMet ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Goal met
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent-strong">
                  <Target className="h-3.5 w-3.5" aria-hidden />
                  In progress
                </span>
              )}
              {progress && progress.streak > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                  <Flame className="h-3.5 w-3.5" aria-hidden />
                  {progress.streak}d streak
                </span>
              )}
            </div>
            {!progressLoading && (
              <DailyGoalEditor
                questionsGoal={todayGoal}
                onSave={handleSaveGoal}
                saving={goalSaving}
              />
            )}
          </div>
        </div>
      </section>

      {/* ===== 2. Quick start: BYOL ===== */}
      <section aria-label="Bring your own lesson" className="mt-6 rounded-2xl border border-accent/25 bg-raised p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white">
            <Link2 className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Bring your own lesson</h2>
            <p className="text-xs text-ink-soft">Paste a YouTube video or playlist link — watch, youtu.be, live, or playlist.</p>
          </div>
        </div>

        <form onSubmit={handleImport} className="mt-4 space-y-3">
          <TextField
            label="YouTube link"
            placeholder="https://www.youtube.com/watch?v=..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onBlur={() => setTouched(true)}
            error={urlInvalid ? urlCheck.reason : importError}
            inputMode="url"
            autoComplete="off"
            required
          />
          <TextField
            label="Topic or study goal (optional)"
            placeholder="e.g. Quadratic equations — master the discriminant"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            maxLength={120}
          />
          <Button type="submit" loading={importing} disabled={!urlCheck.valid}>
            <Play className="h-4 w-4" aria-hidden />
            Start studying
          </Button>
        </form>
      </section>

      {/* ===== 3. Learning outcomes grid ===== */}
      <section aria-label="Your learning outcomes" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OutcomeCard
          label="Active missions"
          value={progressLoading ? null : progress?.practice.missionsActive ?? 0}
          icon={<Target className="h-4 w-4" aria-hidden />}
        />
        <OutcomeCard
          label="Missions completed"
          value={progressLoading ? null : progress?.practice.missionsCompleted ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
        />
        <OutcomeCard
          label="Completed practice attempts"
          value={progressLoading ? null : progress?.practice.quizAttempts ?? 0}
          icon={<PencilLine className="h-4 w-4" aria-hidden />}
        />
        <OutcomeCard
          label="Questions answered correctly"
          value={progressLoading ? null : progress?.practice.correct ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
        />
      </section>

      {/* ===== 3b. Your Achievements ===== */}
      <section aria-label="Your achievements" className="mt-6 rounded-2xl border border-line bg-raised p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
            <Trophy className="h-4.5 w-4.5 text-accent-strong" aria-hidden />
          </span>
          <div className="flex-1">
            <h2 className="font-display text-lg font-bold text-ink">Your Achievements</h2>
            <p className="text-xs text-ink-soft">
              {achievements
                ? `${achievements.earnedCount} of ${achievements.badges.length} earned — badges are awarded for real, server-verified progress.`
                : 'Loading your badges…'}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {achievements ? (
            achievements.badges.map((badge) => (
              <div
                key={badge.slug}
                className={`flex flex-col items-center rounded-2xl border p-5 text-center transition-all ${
                  badge.earned
                    ? 'border-accent/30 bg-gradient-to-br from-accent-soft/30 to-raised'
                    : 'border-line bg-sunken/40'
                }`}
              >
                <BadgeArtwork slug={badge.slug} earned={badge.earned} size={88} />
                <p className="mt-3 font-display text-sm font-bold text-ink">{badge.name}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{badge.description}</p>
                {badge.earned ? (
                  badge.earnedAt && (
                    <p className="mt-2 text-[11px] font-medium text-accent-strong">
                      Earned {new Date(badge.earnedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )
                ) : (
                  <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint">
                    <Lock className="h-3 w-3" aria-hidden />
                    Locked
                  </p>
                )}
              </div>
            ))
          ) : (
            skeletonArray(3).map((i) => (
              <div key={i} className="flex flex-col items-center rounded-2xl border border-line bg-sunken/40 p-5">
                <div className="h-[88px] w-[88px] animate-pulse rounded-2xl bg-sunken" />
                <div className="mt-3 h-3 w-20 animate-pulse rounded bg-sunken" />
                <div className="mt-2 h-2 w-28 animate-pulse rounded bg-sunken" />
              </div>
            ))
          )}
        </div>

        {achievements && achievements.earnedCount === 0 && (
          <p className="mt-4 rounded-xl bg-sunken/60 px-4 py-3 text-xs leading-relaxed text-ink-soft">
            New here? Complete your first validated mission or finish a practice attempt to earn your first badge. Every badge reflects genuine, server-graded progress — nothing is awarded for just opening the app.
          </p>
        )}
      </section>

      {/* ===== 4. Today's accuracy + recent activity ===== */}
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-raised p-5 shadow-sm lg:col-span-1">
          <h3 className="font-display text-sm font-bold text-ink">Today</h3>
          {progressLoading ? (
            <div className="mt-3 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-sunken" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-sunken" />
            </div>
          ) : todayAnswered === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No practice yet today. Answer your first question to start counting.
            </p>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Answered today</dt>
                <dd className="font-semibold text-ink tabular-nums">{todayAnswered}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Correct today</dt>
                <dd className="font-semibold text-ink tabular-nums">{todayCorrect}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Today&apos;s accuracy</dt>
                <dd className="font-semibold text-ink tabular-nums">
                  {todayAnswered > 0 ? `${Math.round((todayCorrect / todayAnswered) * 100)}%` : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Missions completed today</dt>
                <dd className="font-semibold text-ink tabular-nums">{progress?.today.missionsCompleted ?? 0}</dd>
              </div>
            </dl>
          )}
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            Accuracy is for today&apos;s practice only — not subject mastery. Wrong-but-honest answers still count toward your daily commitment.
          </p>
        </div>

        {/* 5. Weekly consistency */}
        <div className="rounded-2xl border border-line bg-raised p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-ink">14-day consistency</h3>
            {!progressLoading && progress && (
              <DailyGoalEditorInlineLink
                questionsGoal={todayGoal}
                onSave={handleSaveGoal}
                saving={goalSaving}
              />
            )}
          </div>
          {progressLoading ? (
            <div className="mt-4 flex h-16 gap-1.5">
              {skeletonArray(14).map((i) => (
                <div key={i} className="h-full flex-1 animate-pulse rounded-md bg-sunken" />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <WeeklyConsistency
                days={progress?.last14 ?? []}
                goal={todayGoal}
                streak={progress?.streak ?? 0}
              />
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Days are counted in your timezone ({progress?.goal.timezone ?? 'Asia/Kolkata'}). A day counts only when you answer at least one question — never just for opening the app.
          </p>
        </div>
      </section>

      {/* ===== 6. Resume lessons ===== */}
      {hasResources && (
        <section aria-label="Your lessons" className="mt-8">
          <h2 className="font-display text-base font-bold text-ink">Resume learning</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {resources?.map((r) => (
              <li key={r.id} className="group relative">
                <button
                  type="button"
                  onClick={() => navigate(`/study/${r.id}`)}
                  className="w-full rounded-2xl border border-line bg-raised p-4 pr-11 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
                      {r.source_type === 'video' ? 'Video' : 'Playlist'}
                    </span>
                    {r.study_sessions && r.study_sessions[0] && r.study_sessions[0].focus_seconds > 0 && (
                      <span className="text-[11px] text-ink-faint">
                        {formatDuration(r.study_sessions[0].focus_seconds)} focused
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium text-ink">
                    {r.topic?.trim() || r.title || `Untitled ${r.source_type === 'video' ? 'video' : 'playlist'}`}
                  </p>
                  {r.channel_name && (
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{r.channel_name}</p>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(r.id)}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-faint opacity-0 transition-opacity hover:bg-sunken hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label="Remove this lesson"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ===== 7. Discovery ===== */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/library')}
          className="group flex flex-col rounded-2xl border border-line bg-raised p-6 text-left shadow-sm transition-all hover:border-accent/40 hover:shadow-md"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
            <Library className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink">Explore curated learning paths</h2>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-soft">
            Classes 9-12 for Indian boards — CBSE, ICSE/ISC and UP Board — with verified chapters marked honestly.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
            Open library
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>

        <div className="flex flex-col rounded-2xl border border-line bg-raised p-6 shadow-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink">Study rooms</h2>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-soft">
            Bring a lesson into a private room with a classmate. Share the same academic mission while each of you learns at your own pace.
          </p>
          <button
            type="button"
            onClick={() => navigate('/rooms')}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong"
          >
            Open study rooms
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* ===== 8. Genuine history ===== */}
      <section className="mt-8 rounded-2xl border border-line bg-raised p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
          <History className="h-4 w-4 text-ink-faint" aria-hidden />
          Your study activity
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-faint">Subject focus</dt>
            <dd className="mt-0.5 font-medium text-ink">{focusedSubject?.name ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Lessons in your library</dt>
            <dd className="mt-0.5 font-medium text-ink">{resources?.length ?? 0}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Focus time (recent lessons)</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {focusTotals ? formatDuration(focusTotals.seconds) : 'No sessions yet'}
            </dd>
          </div>
        </dl>
        {progress && (
          <dl className="mt-4 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-1.5 text-ink-faint">
                <PencilLine className="h-3.5 w-3.5" aria-hidden />
                Practice answers graded
              </dt>
              <dd className="mt-0.5 font-medium text-ink">{progress.practice.attempts}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-ink-faint">
                <Target className="h-3.5 w-3.5" aria-hidden />
                Passing practice attempts
              </dt>
              <dd className="mt-0.5 font-medium text-ink">{progress.practice.passedAttempts}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Practice days (14d)</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {progress.practice.activeDays.length > 0 ? progress.practice.activeDays.length : 'None yet'}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Focus time counts only while a lesson is actually playing and this tab is visible. Nothing here is estimated or simulated.
        </p>
      </section>
    </div>
  );
}

function OutcomeCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center gap-2 text-ink-faint">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sunken">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
        {value === null ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-sunken" /> : value}
      </p>
    </div>
  );
}

function DailyGoalEditorInlineLink({
  questionsGoal,
  onSave,
  saving,
}: {
  questionsGoal: number;
  onSave: (g: number) => Promise<void>;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-accent hover:text-accent-strong"
      >
        Adjust goal
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-sunken/60 p-3">
      <DailyGoalEditor questionsGoal={questionsGoal} onSave={async (g) => { await onSave(g); setOpen(false); }} saving={saving} />
    </div>
  );
}
