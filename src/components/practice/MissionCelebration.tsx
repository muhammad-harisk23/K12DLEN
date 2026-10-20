import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Home,
  RefreshCw,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { AchievementSharePanel } from '@/components/practice/AchievementSharePanel';
import { BadgeArtwork } from '@/components/practice/BadgeArtwork';
import type { AchievementData } from '@/lib/achievementCanvas';
import type { Badge } from '@/lib/achievements';
import { AVAILABLE_SETS, PASS_THRESHOLD } from '@/lib/practiceCore';
import type { MissionSummary } from '@/lib/practiceCore';

interface CelebrationData {
  correct: number;
  total: number;
  attemptNumber?: number;
}

interface MissionCelebrationProps {
  mission: MissionSummary;
  data: CelebrationData;
  unlockedBadges?: Badge[];
  onClose: () => void;
  onReviewMistakes: () => void;
  onGoDashboard: () => void;
  onContinueLearning: () => void;
  hasLinkedLesson: boolean;
}

export function MissionCelebration({
  mission,
  data,
  unlockedBadges = [],
  onClose,
  onReviewMistakes,
  onGoDashboard,
  onContinueLearning,
  hasLinkedLesson,
}: MissionCelebrationProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const set = AVAILABLE_SETS.find((s) => s.slug === mission.topicSlug);
  const accuracyVal = data.total > 0 ? data.correct / data.total : 0;
  const accuracyPct = Math.round(accuracyVal * 100);
  const passed = accuracyVal >= PASS_THRESHOLD;

  useEffect(() => {
    closeBtnRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function handleCopy() {
    const text = `I completed my study mission on K12Learn2Gether: "${mission.missionText}" — ${data.correct}/${data.total} on ${set?.label ?? mission.topicSlug} practice.`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    });
  }

  const accessibleSummary = `Mission accomplished. ${mission.missionText}. You scored ${data.correct} out of ${data.total} — ${accuracyPct} percent on ${set?.label ?? mission.topicSlug} practice.${data.attemptNumber ? ` Attempt ${data.attemptNumber}.` : ''}`;

  const achievementData: AchievementData = {
    missionText: mission.missionText,
    topicLabel: set?.label ?? mission.topicSlug,
    subjectName: set?.subject,
    correct: data.correct,
    total: data.total,
    attemptNumber: data.attemptNumber,
    completedAt: null,
  };

  return (
    <div
      className="celebration-overlay fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Mission completion celebration"
    >
      <div
        ref={dialogRef}
        className="celebration-card celebration-glow relative w-full max-w-lg overflow-hidden rounded-3xl border border-accent/20 bg-raised shadow-2xl"
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Close celebration"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        {/* Floating accents — subtle decorative shapes, not confetti */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="celebration-accent-1 absolute left-8 top-20 h-2 w-2 rounded-full bg-accent/30" />
          <div className="celebration-accent-2 absolute right-12 top-32 h-1.5 w-1.5 rounded-full bg-accent/20" />
          <div className="celebration-accent-3 absolute left-16 bottom-40 h-2 w-2 rounded-full bg-accent/25" />
        </div>

        <div className="relative p-6 sm:p-10">
          {/* Stage A — Accomplishment */}
          <div className="celebration-stage-a text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent-strong">
              K12Learn2Gether
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Mission accomplished.
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
              {mission.missionText}
            </p>
          </div>

          {/* Stage B — Animated progress */}
          <div className="celebration-stage-b mt-8 flex flex-col items-center">
            <ProgressRing
              value={accuracyVal}
              size={148}
              stroke={11}
              accessibleLabel={`${accuracyPct}% accuracy — ${data.correct} of ${data.total} correct`}
            >
              <span className="font-display text-3xl font-bold text-ink tabular-nums">{accuracyPct}%</span>
              <span className="mt-0.5 text-xs text-ink-soft">{data.correct}/{data.total} correct</span>
            </ProgressRing>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong">
                <Check className="h-3.5 w-3.5" aria-hidden />
                {set?.label ?? mission.topicSlug}
              </span>
              {data.attemptNumber && data.attemptNumber > 1 && (
                <span className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-ink-soft">
                  Attempt {data.attemptNumber}
                </span>
              )}
              {passed && (
                <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-ink">
                  Passed (≥{Math.round(PASS_THRESHOLD * 100)}%)
                </span>
              )}
            </div>
          </div>

          {/* Stage C — Rewarding moment: share card preview */}
          <div className="celebration-stage-c mt-7">
            <div className="rounded-2xl border border-line bg-gradient-to-br from-accent-soft/40 to-raised p-5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-strong">
                Achievement record
              </p>
              <p className="mt-2 font-display text-sm font-bold leading-snug text-ink">
                {mission.missionText}
              </p>
              <p className="mt-1.5 text-xs text-ink-soft">
                {data.correct}/{data.total} · {set?.label ?? mission.topicSlug}
              </p>
              <p className="mt-3 text-[10px] text-ink-faint">
                Only what you see here is shared — your name and identity stay private.
              </p>
            </div>
          </div>

          {/* Stage C2 — Badge unlock reveal (only when new badges were earned) */}
          {unlockedBadges.length > 0 && (
            <div className="celebration-stage-c mt-6 rounded-2xl border border-accent/30 bg-accent-soft/30 p-5">
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-accent-strong">
                <Sparkles className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                {unlockedBadges.length === 1 ? 'New badge unlocked' : `${unlockedBadges.length} new badges unlocked`}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-4">
                {unlockedBadges.map((badge) => (
                  <div key={badge.slug} className="flex flex-col items-center text-center">
                    <div className="badge-unlock-silhouette">
                      <BadgeArtwork slug={badge.slug} earned size={80} />
                    </div>
                    <p className="mt-2 font-display text-xs font-bold text-ink">{badge.name}</p>
                    <p className="mt-0.5 max-w-[140px] text-[11px] leading-relaxed text-ink-soft">
                      {badge.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage D — Next actions */}
          <div className="celebration-stage-d mt-6 space-y-3">
            <div className="flex flex-wrap gap-2.5">
              <Button onClick={onContinueLearning} className="flex-1">
                {hasLinkedLesson ? (
                  <>
                    Continue lesson
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                ) : (
                  <>
                    Back to practice
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
              <Button variant="secondary" onClick={onGoDashboard}>
                <Home className="h-4 w-4" aria-hidden />
                Dashboard
              </Button>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="ghost" size="sm" onClick={onReviewMistakes}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Review mistakes
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Copy share text
                  </>
                )}
              </Button>
            </div>
            <Button variant="secondary" onClick={() => setShowShare(true)} className="w-full">
              <Share2 className="h-4 w-4" aria-hidden />
              Share achievement image
            </Button>
          </div>
        </div>

        {/* Screen reader announcement */}
        <span className="sr-only" role="status" aria-live="polite">
          {accessibleSummary}
        </span>
      </div>

      {showShare && (
        <AchievementSharePanel
          data={achievementData}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
