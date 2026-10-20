import { CheckCircle2, Copy, Link2, Share2, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { AchievementSharePanel } from '@/components/practice/AchievementSharePanel';
import type { AchievementData } from '@/lib/achievementCanvas';
import { AVAILABLE_SETS, PASS_THRESHOLD } from '@/lib/practiceCore';
import type { MissionSummary } from '@/lib/practiceCore';

interface CompleteResultShape {
  status?: string;
  reason?: string;
  correct?: number;
  total?: number;
  attemptNumber?: number;
  completedAttempts?: number;
}

interface MissionCompleteCardProps {
  completing: boolean;
  result: CompleteResultShape | null;
  mission: MissionSummary | null;
  /** True when the mission was already completed before this session — suppresses the full celebration. */
  alreadyCompleted?: boolean;
  onComplete: () => void;
  onDismiss: () => void;
  onOpenLesson: (resourceId: string) => void;
}

const COMPLETED = 'completed';

export function MissionCompleteCard({
  completing,
  result,
  mission,
  alreadyCompleted = false,
  onComplete,
  onDismiss,
  onOpenLesson,
}: MissionCompleteCardProps) {
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);
  if (!mission) return null;
  const set = AVAILABLE_SETS.find((s) => s.slug === mission.topicSlug);
  const isCompleted = result?.status === COMPLETED;

  function handleCopy() {
    if (!mission || !result) return;
    const text = `I completed my study mission on K12Learn2Gether: "${mission.missionText}" — ${result.correct}/${result.total} on ${set?.label ?? mission.topicSlug} practice.`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <section
      aria-label="Complete your mission"
      className="mt-8 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-soft/70 via-raised to-raised shadow-sm"
    >
      <div className="p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
          Your study mission
        </p>
        <p className="mt-2 font-display text-lg font-bold leading-snug text-ink">
          {mission.missionText}
        </p>

        {isCompleted ? (
          <div className="mt-6">
            {/* Premium completed state */}
            <div className="flex flex-col items-center gap-5 rounded-2xl border border-accent/20 bg-raised p-6 text-center shadow-sm sm:flex-row sm:text-left">
              <ProgressRing
                value={result && result.total ? (result.correct ?? 0) / result.total : 0}
                size={108}
                stroke={9}
                accessibleLabel={`Mission completed with ${result?.correct ?? 0} out of ${result?.total ?? 0} correct`}
              >
                <span className="font-display text-xl font-bold text-ink tabular-nums">
                  {result && result.total ? Math.round(((result.correct ?? 0) / result.total) * 100) : 0}%
                </span>
              </ProgressRing>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-accent-strong" aria-hidden />
                  <p className="font-display text-lg font-bold text-ink">
                    {alreadyCompleted ? 'Mission completed' : 'Mission complete'}
                  </p>
                </div>
                <p className="mt-1.5 text-sm text-ink-soft">
                  You scored {result?.correct}/{result?.total} on the {set?.label ?? mission.topicSlug} practice set.
                  {result?.attemptNumber ? ` Attempt ${result.attemptNumber}.` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-strong">
                    {set?.label ?? mission.topicSlug}
                  </span>
                  {result && result.total && (result.correct ?? 0) / result.total >= PASS_THRESHOLD && (
                    <span className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-[11px] font-semibold text-ink">
                      Passed (≥{Math.round(PASS_THRESHOLD * 100)}%)
                    </span>
                  )}
                  {alreadyCompleted && (
                    <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[11px] font-medium text-ink-faint">
                      Already completed
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Achievement card preview */}
            <div className="mt-5 rounded-2xl border border-line bg-raised p-5 text-center shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-accent-strong">
                K12Learn2Gether
              </p>
              <p className="mt-3 font-display text-lg font-bold leading-snug text-ink">
                Mission complete
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
                {mission.missionText}
              </p>
              <p className="mt-3 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong">
                {result?.correct}/{result?.total} · {set?.label ?? mission.topicSlug}
              </p>
              <p className="mt-4 text-[10px] text-ink-faint">
                Only what you see here is shared — your name and identity stay private.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setShowShare(true)}>
                <Share2 className="h-4 w-4" aria-hidden />
                Share achievement image
              </Button>
              <Button variant="ghost" onClick={handleCopy}>
                {copied ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy share text
                  </>
                )}
              </Button>
              {mission.resourceId && (
                <Button variant="ghost" onClick={() => onOpenLesson(mission.resourceId!)}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Back to lesson
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <ul className="mt-5 space-y-2 text-sm text-ink-soft">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                Answer every question in the {set?.label ?? mission.topicSlug} practice set
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                Score at least {Math.round(PASS_THRESHOLD * 100)}% overall
              </li>
            </ul>
            {result?.status === 'criteria_not_met' && (
              <p className="mt-4 rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink-soft" role="alert">
                {result.reason}
              </p>
            )}
            {result?.status === 'error' && (
              <p className="mt-4 rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
                Something went wrong. Please try again.
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={onComplete} loading={completing}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Mark mission complete
              </Button>
              {mission.resourceId && (
                <Button variant="secondary" onClick={() => onOpenLesson(mission.resourceId!)}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Open linked lesson
                </Button>
              )}
            </div>
          </>
        )}

        {result && result.status !== 'criteria_not_met' && result.status !== 'error' && (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink-soft"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Dismiss
          </button>
        )}
      </div>

      {showShare && isCompleted && result && (
        <AchievementSharePanel
          data={{
            missionText: mission.missionText,
            topicLabel: set?.label ?? mission.topicSlug,
            subjectName: set?.subject,
            correct: result.correct ?? 0,
            total: result.total ?? 0,
            attemptNumber: result.attemptNumber,
            completedAt: null,
          } satisfies AchievementData}
          onClose={() => setShowShare(false)}
        />
      )}
    </section>
  );
}
